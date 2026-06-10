import { api } from './api';

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

export interface EcfIndicador {
  id: string;
  cnpj: string;
  razaoSocial: string;
  anoCalendario: number;
  formaTributacao: string;
  faturamentoDeclarado: string;       // Decimal serializado como string (Prisma)
  prejuizoFiscalAcumulado: string;
  baseNegativaCsll: string;
  exercicioEcf: string;
  gcsUri: string;
  processadoEm: string;
}

export interface EmpresaComEcf {
  cnpj:        string;
  razaoSocial: string;
}

export interface BuscarFiltros {
  faturamentoMin?: number;
  faturamentoMax?: number;
  temPrejuizo?: boolean;
  ano?: number;
}

/* ─── API calls ──────────────────────────────────────────────────────────── */

export const indicadoresEcfApi = {
  /** Empresas do tenant com dados ECF processados */
  empresas: (): Promise<EmpresaComEcf[]> =>
    api.get<EmpresaComEcf[]>('/indicadores-ecf/empresas').then(r => r.data),

  /** Todos os registros de um CNPJ em todos os anos */
  individual: (cnpj: string): Promise<EcfIndicador[]> =>
    api.get<EcfIndicador[]>('/indicadores-ecf/individual', { params: { cnpj } }).then(r => r.data),

  /** Série histórica filtrada por ano */
  historico: (cnpj: string, anoInicio?: number, anoFim?: number): Promise<EcfIndicador[]> =>
    api.get<EcfIndicador[]>('/indicadores-ecf/historico', {
      params: { cnpj, ...(anoInicio !== undefined ? { anoInicio } : {}), ...(anoFim !== undefined ? { anoFim } : {}) },
    }).then(r => r.data),

  /** Registro mais recente do CNPJ */
  consolidado: (cnpj: string): Promise<EcfIndicador | null> =>
    api.get<EcfIndicador | null>('/indicadores-ecf/consolidado', { params: { cnpj } }).then(r => r.data),

  /** Empresas do tenant que atendem aos filtros */
  buscar: (filtros: BuscarFiltros): Promise<EcfIndicador[]> =>
    api.get<EcfIndicador[]>('/indicadores-ecf/buscar', { params: filtros }).then(r => r.data),
};
