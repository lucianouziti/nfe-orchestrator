import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { TenantRepository, ActiveTenant } from '../database/repositories/tenant.repository';

export interface NfeSyncJobPayload {
  cnpj: string;
  database: string;
  uf: string;
  ambiente: number;        // 1=Produção, 2=Homologação
  certificateId: string;   // ID do cert no microserviço certificados-digitais
  lastNsu: string;         // Último NSU consultado (cursor da SEFAZ)
  shardIndex: number;
  totalShards: number;
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  private readonly shardSize: number;
  private readonly syncWindowMs: number;
  private readonly queueName: string;

  constructor(
    @InjectQueue('nfe-sync') private readonly nfeSyncQueue: Queue,
    private readonly tenantRepository: TenantRepository,
    private readonly configService: ConfigService,
  ) {
    this.shardSize = this.configService.get<number>('SHARD_SIZE', 100);
    this.syncWindowMs = this.configService.get<number>('SYNC_WINDOW_MINUTES', 14) * 60 * 1000;
    this.queueName = this.configService.get<string>('NFE_SYNC_QUEUE', 'nfe-sync');
  }

  /**
   * Ponto de entrada do ciclo de sincronização.
   * Chamado pelo scheduler a cada execução do cron.
   *
   * Estratégia de Sharding:
   * - Divide os CNPJs em lotes de SHARD_SIZE
   * - Cada shard recebe um delay proporcional à janela de sincronização
   * - Isso distribui a carga ao longo do tempo, evitando pico de requisições à SEFAZ
   *
   * Exemplo: 10.000 CNPJs, shard_size=100, janela=14min
   *   → 100 shards, delay entre shards = 8.4 segundos
   *   → Jobs distribuídos uniformemente ao longo de 14 minutos
   */
  async runSyncCycle(): Promise<void> {
    const cycleId = Date.now().toString(36).toUpperCase();
    this.logger.log(`[Ciclo ${cycleId}] Iniciando ciclo de sincronização NF-e`);

    const totalActive = await this.tenantRepository.countActive();
    if (totalActive === 0) {
      this.logger.warn(`[Ciclo ${cycleId}] Nenhum tenant ativo encontrado`);
      return;
    }

    const totalShards = Math.ceil(totalActive / this.shardSize);
    const delayPerShard = Math.floor(this.syncWindowMs / totalShards);

    this.logger.log(
      `[Ciclo ${cycleId}] ${totalActive} CNPJs ativos → ${totalShards} shards de ${this.shardSize} ` +
      `(delay entre shards: ${delayPerShard}ms)`,
    );

    let totalEnqueued = 0;
    let page = 0;

    while (true) {
      const tenants = await this.tenantRepository.findActivePage(page, this.shardSize);
      console.log("🚀 ~ OrchestratorService ~ runSyncCycle ~ tenants:", tenants)
      if (tenants.length === 0) break;

      const shardDelay = page * delayPerShard;
      const enqueued = await this.enqueueShardJobs(tenants, page, totalShards, shardDelay, cycleId);

      totalEnqueued += enqueued;
      page++;
    }

    this.logger.log(`[Ciclo ${cycleId}] Ciclo concluído. ${totalEnqueued} jobs enfileirados.`);
  }

  /**
   * Enfileira os jobs de um shard com delay escalonado.
   * Usa job ID determinístico para evitar duplicatas no BullMQ.
   */
  private async enqueueShardJobs(
    tenants: ActiveTenant[],
    shardIndex: number,
    totalShards: number,
    delayMs: number,
    cycleId: string,
  ): Promise<number> {
    // Filtra tenants sem certificado cadastrado — não é possível consultar a SEFAZ sem ele
    // const tenantsSemCert = tenants.filter((t) => !t.certificateId);
    // if (tenantsSemCert.length > 0) {
    //   this.logger.warn(
    //     `[Ciclo ${cycleId}] ${tenantsSemCert.length} tenant(s) sem certificateId serão ignorados: ` +
    //     tenantsSemCert.map((t) => t.cnpj).join(', '),
    //   );
    // }
    //const tenantsValidos = tenants.filter((t) => !!t.certificateId);
    const tenantsValidos = tenants;

    const jobs = tenantsValidos.map((tenant) => ({
      name: 'nfe-sync',
      data: {
        cnpj: tenant.cnpj,
        database: tenant.database,
        uf: tenant.uf || 'SP',
        ambiente: tenant.ambiente || 1,
        certificateId: tenant.certificateId,
        lastNsu: tenant.lastNsu || '000000000000000',
        shardIndex,
        totalShards,
      } as NfeSyncJobPayload,
      opts: {
        // ID determinístico: evita enfileirar o mesmo CNPJ duas vezes no mesmo ciclo
        jobId: `nfe-sync_${tenant.cnpj}`,
        delay: delayMs,
        attempts: this.configService.get<number>('JOB_MAX_RETRIES', 3),
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    }));

    try {
      await this.nfeSyncQueue.addBulk(jobs);

      // Atualiza lastNfeSync em lote para não re-enfileirar no próximo ciclo
      const cnpjs = tenantsValidos.map((t) => t.cnpj);
      await this.tenantRepository.markAsSyncing(cnpjs);

      this.logger.debug(
        `[Ciclo ${cycleId}] Shard ${shardIndex + 1}/${totalShards}: ` +
        `${tenants.length} jobs enfileirados (delay: ${delayMs}ms)`,
      );

      return tenantsValidos.length;
    } catch (error) {
      this.logger.error(
        `[Ciclo ${cycleId}] Erro ao enfileirar shard ${shardIndex}: ${error.message}`,
        error.stack,
      );
      return 0;
    }
  }

  /**
   * Retorna estatísticas da fila para monitoramento.
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.nfeSyncQueue.getWaitingCount(),
      this.nfeSyncQueue.getActiveCount(),
      this.nfeSyncQueue.getCompletedCount(),
      this.nfeSyncQueue.getFailedCount(),
      this.nfeSyncQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
