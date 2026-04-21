import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';

@Module({
  controllers: [AppController],
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
      useFactory: (configService: ConfigService) => {
        const { hostname, port, password } = new URL(
          configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
        );
        return {
          connection: {
            host: hostname,
            port: parseInt(port || '6379', 10),
            password: password || undefined,
            maxRetriesPerRequest: null, // necessário para BullMQ
          },
        };
      },
      inject: [ConfigService],
    }),

    // Módulo principal de orquestração
    OrchestratorModule,
  ],
})
export class AppModule {}
