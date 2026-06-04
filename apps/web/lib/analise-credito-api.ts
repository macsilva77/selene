import { api } from './api';

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

export type Classificacao = 'A' | 'B' | 'C' | 'D' | 'E';
export type Severidade    = 'critico' | 'atencao' | 'positivo';

export interface UltimaClassificacao {
  exercicio:        number;
  classificacao:    Classificacao;
  classificacaoNum: number;
  qtdCriticos:      number;
  qtdAtencao:       number;
  qtdPositivos:     number;
  confiabilidade:   string;
  overrideAplicado: boolean;
  motivoOverride:   string | null;
}

export interface EmpresaResumo {
  cnpj:                string;
  razaoSocial:         string;
  regimeTributario:    string | null;
  ultimaClassificacao: UltimaClassificacao | null;
}

export interface StatusPipeline {
  exercicio:      number;
  p01:            string | null;
  p02:            string | null;
  p03:            string | null;
  p04:            string | null;
  totalBloqueios: number;
}

export interface Indicador {
  id:        string;
  exercicio: number;
  indicador: string;
  valor:     string | null;
  unidade:   string;
  fonteOk:   number;
}

export interface Alerta {
  id:          string;
  exercicio:   number;
  codigoRegra: string;
  severidade:  Severidade;
  indicador:   string;
  valorAtual:  string | null;
  mensagem:    string;
  categoria:   string;
  regraOk:     number;
}

export interface ClassificacaoRisco {
  id:               string;
  exercicio:        number;
  classificacao:    Classificacao;
  classificacaoNum: number;
  qtdCriticos:      number;
  qtdAtencao:       number;
  qtdPositivos:     number;
  confiabilidade:   string;
  overrideAplicado: boolean;
  motivoOverride:   string | null;
  dataGeracao:      string;
}

export interface ResumoFinanceiro {
  exercicio:      number;
  dre: Record<string, string | null>;       // linhaDre → valor (string Decimal)
  estrutura: {
    ativoTotal:          string | null;
    passivoTotal:        string | null;
    pl:                  string | null;
    dividaFinanceiraCp:  string | null;
    dividaFinanceiraLp:  string | null;
    dividaFinanceiraTot: string | null;
    dividaLiquida:       string | null;
  } | null;
}

export interface DemonstracaoRow {
  linhaCodigo: string;
  descricao:   string;
  valor:       string;   // Decimal serializado como string
  nivel:       number;
  haFilhos:    boolean;
  natureza:    'DEVEDOR' | 'CREDOR';
}

export interface Inconsistencia {
  id:         string;
  exercicio:  number;
  tipoErro:   string;
  descricao:  string;
  severidade: string;
  criadoEm:   string;
}

/* ─── API calls ──────────────────────────────────────────────────────────── */

export const analiseCreditoApi = {
  /** Lista empresas do tenant com última classificação */
  listarEmpresas: () =>
    api.get<EmpresaResumo[]>('/analise-credito/empresas').then(r => r.data),

  /** Status do pipeline P01→P04 por exercício */
  statusPipeline: (cnpj: string) =>
    api.get<StatusPipeline[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/status`).then(r => r.data),

  /** Indicadores financeiros */
  indicadores: (cnpj: string, exercicio?: number) =>
    api.get<Indicador[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/indicadores`, {
      params: exercicio === undefined ? undefined : { exercicio },
    }).then(r => r.data),

  /** Alertas de risco */
  alertas: (cnpj: string, exercicio?: number) =>
    api.get<Alerta[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/alertas`, {
      params: exercicio === undefined ? undefined : { exercicio },
    }).then(r => r.data),

  /** Histórico de classificações */
  classificacao: (cnpj: string) =>
    api.get<ClassificacaoRisco[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/classificacao`).then(r => r.data),

  /** Inconsistências detectadas no pipeline */
  inconsistencias: (cnpj: string) =>
    api.get<Inconsistencia[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/inconsistencias`).then(r => r.data),

  /** Resumo financeiro (DRE + Estrutura de Capital) por exercício */
  financeiro: (cnpj: string, exercicio: number): Promise<ResumoFinanceiro> =>
    api.get(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/financeiro`, {
      params: { exercicio },
    }).then(r => r.data),

  /** Exercícios disponíveis para um CNPJ (ECF processado) */
  exercicios: (cnpj: string) =>
    api.get<number[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/exercicios`).then(r => r.data),

  /** Balanço Patrimonial (L100) ou DRE (L300) de um CNPJ/exercício */
  demonstracoes: (cnpj: string, tipo: 'balanco' | 'dre', exercicio: number, contaRef?: string) =>
    api.get<DemonstracaoRow[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/demonstracoes`, {
      params: { tipo, exercicio, ...(contaRef ? { contaRef } : {}) },
    }).then(r => r.data),

  /** Dispara pipeline completo P01→P04 */
  dispararPipeline: () =>
    api.post('/analise-credito/pipeline/processar').then(r => r.data),

  /** Apaga dados calculados P02→P04 (balanco, dre, indicadores, alertas, classificações) */
  resetarDados: (): Promise<{ mensagem: string; totais: Record<string, number> }> =>
    api.post('/analise-credito/admin/resetar').then(r => r.data),

  /** Dispara apenas P01 para todos os CNPJs */
  dispararP01: (forcar = false) =>
    api.post('/analise-credito/p01/processar', undefined, {
      params: forcar ? { forcar: 'true' } : undefined,
    }).then(r => r.data),
};
