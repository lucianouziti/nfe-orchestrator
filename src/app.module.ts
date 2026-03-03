import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';

@Module({
  imports: [
    // Configuração global com validação (padrão erp-core)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
      cache: true,
    }),

    // Agendador de tarefas
    ScheduleModule.forRoot(),

    // Conexão MongoDB master (padrão erp-core)
    DatabaseModule,

    // BullMQ com Redis - conexão global compartilhada por todas as filas
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null, // necessário para BullMQ
        },
      }),
      inject: [ConfigService],
    }),

    // Módulo principal de orquestração
    OrchestratorModule,
  ],
})
export class AppModule {}
