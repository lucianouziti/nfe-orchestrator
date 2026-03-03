import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Módulo de banco de dados seguindo o padrão do erp-core.
 * Usa apenas a conexão MASTER para leitura dos tenants/CNPJs ativos.
 * O Orchestrator não precisa de conexões dinâmicas por tenant.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: 'master',
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI_MASTER'),
        dbName: 'master',
        maxPoolSize: configService.get<number>('MASTER_POOL_MAX', 10),
        minPoolSize: configService.get<number>('MASTER_POOL_MIN', 2),
        serverSelectionTimeoutMS: configService.get<number>('DB_SELECT_TIMEOUT', 5000),
        socketTimeoutMS: configService.get<number>('DB_SOCKET_TIMEOUT', 45000),
        retryWrites: configService.get<boolean>('DB_RETRY_WRITES', true),
        retryReads: configService.get<boolean>('DB_RETRY_READS', true),
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
