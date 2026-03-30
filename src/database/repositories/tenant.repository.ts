import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant, TenantDocument, TenantStatus } from '../schemas/tenant.schema';

export interface ActiveTenant {
  cnpj: string;
  database: string;
  uf: string;
  ambiente: number;
  certificateId: string;
  lastNsu: string;
  lastNfeSync?: Date;
}

@Injectable()
export class TenantRepository {
  private readonly logger = new Logger(TenantRepository.name);

  constructor(
    @InjectModel(Tenant.name, 'master')
    private readonly tenantModel: Model<TenantDocument>,
  ) {}

  /**
   * Busca tenants ativos em páginas para evitar carregar todos na memória.
   * Usa cursor para eficiência com 10k+ registros.
   */
  async findActivePage(page: number, pageSize: number): Promise<ActiveTenant[]> {
    const skip = page;
    //console.log("🚀 ~ TenantRepository ~ findActivePage ~ skip:", skip, pageSize)

    const tenants = await this.tenantModel
      .find(
        {
          status: TenantStatus.ACTIVE,
        },
        {
          cnpj: 1,
          database: 1,
          uf: 1,
          ambiente: 1,
          certificateId: 1,
          lastNsu: 1,
          lastNfeSync: 1,
          id: 1,
          _id: 0,
        },
      )
      .skip(skip)
      .limit(pageSize)
      .sort({ cnpj: 1 }) // ordenação estável para sharding consistente
      .lean()
      .exec();


    return tenants as ActiveTenant[];
  }

  /**
   * Conta total de tenants ativos (para calcular shards).
   */
  async countActive(): Promise<number> {
    return this.tenantModel.countDocuments({
      status: TenantStatus.ACTIVE,
    });
  }

  /**
   * Atualiza lastNfeSync para marcar que o job foi criado.
   * Usa updateMany para eficiência em lote.
   */
  async markAsSyncing(cnpjs: string[]): Promise<void> {
    if (cnpjs.length === 0) return;

    await this.tenantModel.updateMany(
      { cnpj: { $in: cnpjs } },
      { $set: { lastNfeSync: new Date() } },
    );

    this.logger.debug(`lastNfeSync atualizado para ${cnpjs.length} CNPJs`);
  }
}
