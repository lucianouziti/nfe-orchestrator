import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { OrchestratorService } from './orchestrator.service';

@Injectable()
export class OrchestratorScheduler {
  private readonly logger = new Logger(OrchestratorScheduler.name);
  private isRunning = false;

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Cron configurável via env SYNC_CRON (padrão: a cada 15 minutos).
   *
   * Proteção contra overlapping: se o ciclo anterior ainda estiver rodando
   * (ex: DB lento ou muitos tenants), o novo ciclo é ignorado com log de alerta.
   * Isso evita que múltiplos ciclos se acumulem e sobrecarreguem o sistema.
   */
  @Cron(process.env.SYNC_CRON || '*/45 6-20 * * *', {
    name: 'nfe-sync-scheduler',
    timeZone: 'America/Sao_Paulo',
  })
  async handleSyncCron(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Ciclo anterior ainda em execução. Pulando este ciclo para evitar overlapping.',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      await this.orchestratorService.runSyncCycle();
    } catch (error) {
      this.logger.error(`Erro fatal no ciclo de sincronização: ${error.message}`, error.stack);
    } finally {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.log(`Ciclo finalizado em ${duration}s`);
      this.isRunning = false;
    }
  }
}
