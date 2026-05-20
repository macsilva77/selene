import { PlanoTenant } from '@prisma/client';

export class TenantEntity {
  id: string;
  nome: string;
  slug: string;
  cnpj: string | null;
  plano: PlanoTenant;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;

  constructor(partial: Partial<TenantEntity>) {
    Object.assign(this, partial);
  }
}
