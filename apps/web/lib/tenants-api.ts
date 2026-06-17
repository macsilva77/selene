import { api } from './api';

export type PlanoTenant = 'free' | 'starter' | 'professional' | 'enterprise';

export interface Tenant {
  id: string;
  nome: string;
  slug: string;
  cnpj?: string | null;
  plano: PlanoTenant;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
  diretorNome?: string | null;
  diretorCargo?: string | null;
  diretorEmail?: string | null;
  diretorDesignadoEm?: string | null;
  _count?: { usuarios: number; contratos: number };
}

export interface TenantMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateTenantPayload {
  nome: string;
  slug: string;
  cnpj?: string;
  plano?: PlanoTenant;
}

export interface UpdateTenantPayload {
  nome?: string;
  cnpj?: string;
  plano?: PlanoTenant;
  diretorNome?: string;
  diretorCargo?: string;
  diretorEmail?: string;
  diretorDesignadoEm?: string;
}

export const tenantsApi = {
  listar: (page = 1, limit = 20) =>
    api
      .get<{ data: Tenant[]; meta: TenantMeta }>('/tenants', { params: { page, limit } })
      .then((r) => r.data),

  criar: (payload: CreateTenantPayload) =>
    api.post<Tenant>('/tenants', payload).then((r) => r.data),

  atualizar: (id: string, payload: UpdateTenantPayload) =>
    api.patch<Tenant>(`/tenants/${id}`, payload).then((r) => r.data),

  suspender: (id: string) =>
    api.post<Tenant>(`/tenants/${id}/suspender`).then((r) => r.data),

  reativar: (id: string) =>
    api.post<Tenant>(`/tenants/${id}/reativar`).then((r) => r.data),
};
