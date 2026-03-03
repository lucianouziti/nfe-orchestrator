import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TenantDocument = Tenant & Document;

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

/**
 * Schema do tenant no banco master.
 * Compatível com a estrutura do erp-core.
 * O Orchestrator lê esta coleção para obter os CNPJs a sincronizar.
 */
@Schema({
  collection: 'tenants',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  autoIndex: true,
})
export class Tenant {
  @Prop({ required: true, unique: true, index: true })
  cnpj: string;

  @Prop({ required: true, index: true, enum: TenantStatus, default: TenantStatus.INACTIVE })
  status: TenantStatus;

  @Prop({ required: false, index: true })
  database?: string; // nome do banco de dados do tenant

  @Prop({ required: false })
  razaoSocial?: string;

  @Prop({ required: false })
  email?: string;

  @Prop({ required: false, index: true })
  uf?: string; // UF do emitente (para rotear para endpoint SEFAZ correto)

  @Prop({ required: false, index: true })
  ambiente?: number; // 1=Produção, 2=Homologação

  /**
   * ID do certificado digital A1 no microserviço certificados-digitais.
   * Usado pelo fetch-service para buscar o cert PEM e autenticar na SEFAZ.
   */
  @Prop({ required: false, index: true })
  certificateId?: string;

  /**
   * Último NSU (Número Sequencial Único) consultado na SEFAZ para este CNPJ.
   * Armazenado aqui para persistência entre ciclos e reinicializações.
   * Formato: string de 15 dígitos (ex: "000000000000042")
   */
  @Prop({ required: false, default: '000000000000000' })
  lastNsu?: string;

  /** Última vez que o Orchestrator enfileirou este CNPJ para sync */
  @Prop({ required: false, index: true })
  lastNfeSync?: Date;

  @Prop({ default: false })
  deleted?: boolean;
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);

// Índices compostos para otimizar as queries do Orchestrator
TenantSchema.index({ status: 1, lastNfeSync: 1 });
TenantSchema.index({ status: 1, deleted: 1, lastNfeSync: 1 });
