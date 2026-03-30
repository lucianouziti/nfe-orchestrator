import { Controller, Post, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorScheduler } from './orchestrator.scheduler';

@Controller('sync')
export class OrchestratorController {
  private readonly logger = new Logger(OrchestratorController.name);

  constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly orchestratorScheduler: OrchestratorScheduler,
  ) {}

  /**
   * Dispara um ciclo de sincronização imediatamente, sem aguardar o cron.
   * Útil para testes e reprocessamentos manuais.
   */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async trigger() {
    this.logger.log('Ciclo de sincronização disparado manualmente via POST /sync/trigger');
    // Executa em background — não aguarda a conclusão para não travar o request
    void this.orchestratorScheduler.handleSyncCron();
    return { message: 'Ciclo de sincronização iniciado.' };
  }

  /**
   * Retorna o status atual da fila nfe-sync.
   */
  @Get('status')
  async status() {
    return this.orchestratorService.getQueueStats();
  }
}
