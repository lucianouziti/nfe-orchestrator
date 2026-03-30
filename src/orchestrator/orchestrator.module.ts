import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorScheduler } from './orchestrator.scheduler';
import { OrchestratorController } from './orchestrator.controller';
import { TenantRepository } from '../database/repositories/tenant.repository';
import { Tenant, TenantSchema } from '../database/schemas/tenant.schema';

@Module({
  imports: [
    // Schema registrado na conexão 'master'
    MongooseModule.forFeature(
      [{ name: Tenant.name, schema: TenantSchema }],
      'master',
    ),
    // Fila de saída para os fetch-workers
    BullModule.registerQueueAsync({
      name: 'nfe-sync',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        name: configService.get<string>('NFE_SYNC_QUEUE', 'nfe-sync'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, OrchestratorScheduler, TenantRepository],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
