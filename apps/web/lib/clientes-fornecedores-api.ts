import { api } from './api';

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

export type ClasseAbc = 'A' | 'B' | 'C';

export interface Competencia {
  ano:              number;
  mes:              number;
  qtdClientes:      number;
  qtdFornecedores:  number;
  status:           string;
  processadoEm:     string;
}

export interface RankingParticipanteRow {
  ranking:              number;
  cnpj:                 string;
  cnpjRaiz:             string;
  razaoSocial:          string;
  valorTotal:           number;
  percentual:           number;   // % do total no período
  acumulado:            number;   // % acumulado (para ABC)
  quantidadeDocumentos: number;
  classeAbc:            ClasseAbc;
}

export interface RaizRankingRow {
  ranking:              number;
  cnpjRaiz:             string;
  razaoSocial:          string;
  valorTotal:           number;
  percentual:           number;
  acumulado:            number;
  quantidadeDocumentos: number;
  qtdCnpjs:             number;   // qtd de CNPJs no grupo
  classeAbc:            ClasseAbc;
}

export interface DrillDownRow {
  cnpj:                 string;
  cnpjRaiz:             string;
  razaoSocial:          string;
  valorTotal:           number;
  percentualGrupo:      number;   // % dentro do grupo
  quantidadeDocumentos: number;
  isMatriz:             boolean;
}

export type TipoParticipante = 'CLIENTE' | 'FORNECEDOR';

export interface RankingParams {
  cnpj:        string;
  anoInicio:   number;
  mesInicio:   number;
  anoFim:      number;
  mesFim:      number;
  tipo:        TipoParticipante;
  topN?:       number;
}

export interface PorCnpjParams {
  cnpj:              string;
  anoInicio:         number;
  mesInicio:         number;
  anoFim:            number;
  mesFim:            number;
  tipo:              TipoParticipante;
  cnpjParticipante:  string;
}

export interface PorRaizParams {
  cnpj:      string;
  anoInicio: number;
  mesInicio: number;
  anoFim:    number;
  mesFim:    number;
  tipo:      TipoParticipante;
}

export interface DrillDownParams {
  cnpj:      string;
  anoInicio: number;
  mesInicio: number;
  anoFim:    number;
  mesFim:    number;
  tipo:      TipoParticipante;
  cnpjRaiz:  string;
}

export interface EmpresaComSped {
  cnpj:        string;
  razaoSocial: string;
}

export interface StatusProcessamentoEmpresa {
  cnpj:              string;
  razaoSocial:       string;
  totalDisponivel:   number;
  processadas:       number;
  pendentes:         number;
  ultimaAtualizacao: string | null;
}

/* ─── API calls ──────────────────────────────────────────────────────────── */

export const clientesFornecedoresApi = {
  /** Empresas que possuem SPEDs processados no tenant */
  empresas: (): Promise<EmpresaComSped[]> =>
    api.get('/clientes-fornecedores/empresas').then(r => r.data),

  /** Competências disponíveis para um CNPJ */
  competencias: (cnpj: string): Promise<Competencia[]> =>
    api.get('/clientes-fornecedores/competencias', { params: { cnpj } }).then(r => r.data),

  /** Ranking top-N de participantes no período */
  ranking: (params: RankingParams): Promise<RankingParticipanteRow[]> =>
    api.get('/clientes-fornecedores/ranking', { params }).then(r => r.data),

  /** Posição no ranking de um participante específico (busca por CNPJ) */
  porCnpj: (params: PorCnpjParams): Promise<RankingParticipanteRow[]> =>
    api.get('/clientes-fornecedores/por-cnpj', { params }).then(r => r.data),

  /** Ranking agrupado por raiz de CNPJ (grupo econômico) */
  porRaiz: (params: PorRaizParams): Promise<RaizRankingRow[]> =>
    api.get('/clientes-fornecedores/por-raiz', { params }).then(r => r.data),

  /** Drill-down dos CNPJs individuais de um grupo econômico */
  drillDown: (params: DrillDownParams): Promise<DrillDownRow[]> =>
    api.get('/clientes-fornecedores/drill-down', { params }).then(r => r.data),

  /** Status de processamento CF por empresa */
  statusProcessamento: (): Promise<StatusProcessamentoEmpresa[]> =>
    api.get('/clientes-fornecedores/status-processamento').then(r => r.data),

  /** Reprocessa SPEDs disponíveis em background — retorna total de competências enfileiradas */
  reprocessar: (): Promise<{ mensagem: string; status: string; total: number }> =>
    api.post('/clientes-fornecedores/reprocessar').then(r => r.data),

  /** Exporta ranking para Excel (.xlsx) */
  exportar: (params: Omit<RankingParams, 'topN'>): Promise<Blob> =>
    api.get('/clientes-fornecedores/exportar', { params, responseType: 'blob' }).then(r => r.data as Blob),
};
