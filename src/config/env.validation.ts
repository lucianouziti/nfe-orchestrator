import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsEnum(['development', 'production', 'test'])
  @IsOptional()
  NODE_ENV: string = 'development';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  PORT: number = 3001;

  // MongoDB
  @IsString()
  @IsNotEmpty({ message: 'MONGODB_URI_MASTER é obrigatória' })
  MONGODB_URI_MASTER: string;

  @IsString()
  @IsNotEmpty({ message: 'MONGODB_URI é obrigatória' })
  MONGODB_URI: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  MASTER_POOL_MAX: number = 10;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  MASTER_POOL_MIN: number = 2;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  DB_SELECT_TIMEOUT: number = 5000;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  DB_SOCKET_TIMEOUT: number = 45000;

  @Type(() => Boolean)
  @IsOptional()
  DB_RETRY_WRITES: boolean = true;

  @Type(() => Boolean)
  @IsOptional()
  DB_RETRY_READS: boolean = true;

  // Redis
  @IsString()
  @IsOptional()
  REDIS_HOST: string = 'localhost';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  REDIS_PORT: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD: string = '';

  // Orchestrator
  @IsString()
  @IsOptional()
  SYNC_CRON: string = '*/15 * * * *';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  SHARD_SIZE: number = 100;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  SYNC_WINDOW_MINUTES: number = 14;

  @IsString()
  @IsOptional()
  TENANTS_COLLECTION: string = 'tenants';

  // BullMQ
  @IsString()
  @IsOptional()
  NFE_SYNC_QUEUE: string = 'nfe-sync';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  JOB_MAX_RETRIES: number = 3;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Configuração inválida:\n${errors.toString()}`);
  }

  return validatedConfig;
}
