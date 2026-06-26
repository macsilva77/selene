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
  processando:    boolean;                  // true = P02 ainda não rodou para este exercício
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
  linhaCodigo:     string;
  descricao:       string;
  valor:           string;   // Decimal serializado como string (saldo final)
  nivel:           number;
  haFilhos:        boolean;
  tipo?:           'S' | 'A' | null;  // Sintética / Analítica
  natureza:        'DEVEDOR' | 'CREDOR';
  fonte?:          string;
  // Campos de movimentação — extraídos do próprio ECF L100 (campos VAL_INI, VL_DEB, VL_CRE, IND_DC)
  saldoAnterior?:    string | null;
  naturezaAnterior?: string | null; // 'D' | 'C'
  totalDebitos?:     string | null;
  totalCreditos?:    string | null;
  naturezaFinal?:    string | null; // 'D' | 'C'
}

export interface DemonstracaoResult {
  trimestres:     number[];   // trimestres disponíveis (1..4 ou [0] para anual/ECD)
  trimestreAtivo: number;
  linhas:         DemonstracaoRow[];
}

export interface Inconsistencia {
  id:         string;
  exercicio:  number;
  tipoErro:   string;
  descricao:  string;
  severidade: string;
  criadoEm:   string;
}

export interface KpiAnual {
  exercicio:         number;
  receitaLiquida:    string | null;
  ebitda:            string | null;
  lucroLiquido:      string | null;
  pl:                string | null;
  dividaFinanceira:  string | null;
}

export type CruzamentoFlag =
  | 'CONSISTENTE'
  | 'SUBDECLARACAO'
  | 'DIVERGENCIA'
  | 'SERVICO'
  | 'SEM_DADOS';

export interface CruzamentoAno {
  ano:        number;
  receitaEcf: number;
  vendasEfd:  number;
  mesesEfd:   number;
  ratio:      number | null; // vendasEfd / receitaEcf
  flag:       CruzamentoFlag;
}

export interface CruzamentoReceita {
  cnpj:        string;
  razaoSocial: string;
  anos:        CruzamentoAno[];
}

/* ─── Simulação Tributária ─────────────────────────────────────────────────── */

export type Atividade = 'comercio' | 'industria' | 'servico';
export type Regime = 'simples_nacional' | 'lucro_presumido' | 'lucro_real';

export interface PassoMemoria {
  rotulo:   string;
  formula?: string;
  valor:    number;
  tipo?:    'moeda' | 'percentual' | 'fator';
}

export interface TributoLinha {
  sigla:    string;
  nome:     string;
  valor:    number;
  partilha?: number;
  memoria:  PassoMemoria[];
}

export interface RegimeSimulado {
  regime:          Regime;
  rotulo:          string;
  elegivel:        boolean;
  totalFederal:    number | null;
  totalUnificado?: number | null;
  cargaEfetiva:    number | null;
  tributos:        TributoLinha[];
  estimado:        boolean;
  observacoes:     string[];
}

export interface Simulacao {
  receitaBruta:    number;
  atividade:       Atividade;
  regimeAtual:     Regime | null;
  regimes:         RegimeSimulado[];
  recomendado:     Regime | null;
  economiaVsAtual: number | null;
  premissas:       string[];
}

export interface SimulacaoTributaria {
  cnpj:            string;
  razaoSocial:     string;
  exercicio:       number;
  regimeAtual:     string | null;
  cnaePrincipal?:  string | null;
  fonteReceita?:   string;
  processando:     boolean;
  mensagem?:       string;
  simulacao:       Simulacao | null;
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
  demonstracoes: (cnpj: string, tipo: 'balanco' | 'dre', exercicio: number, contaRef?: string, trimestre?: number) =>
    api.get<DemonstracaoResult>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/demonstracoes`, {
      params: { tipo, exercicio, ...(contaRef ? { contaRef } : {}), ...(trimestre === undefined ? {} : { trimestre }) },
    }).then(r => r.data),

  /** KPIs primários para todos os exercícios disponíveis */
  kpisAnuais: (cnpj: string) =>
    api.get<KpiAnual[]>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/kpis-anuais`).then(r => r.data),

  /** Cruzamento Receita ECF × Faturamento EFD por ano (qualidade de dado / risco) */
  cruzamentoReceita: (cnpj: string) =>
    api.get<CruzamentoReceita>(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/cruzamento-receita`).then(r => r.data),

  /** Simulação tributária Simples × Presumido × Real (com memória de cálculo) */
  simulacaoTributaria: (cnpj: string, exercicio: number): Promise<SimulacaoTributaria> =>
    api.get(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/simulacao-tributaria`, {
      params: { exercicio },
    }).then(r => r.data),

  /**
   * Lê ECF Parquet → calcula indicadores, DRE, estrutura → salva → roda alertas.
   * Equivale ao antigo pipeline P02→P03→P04, mas lendo direto da fonte correta.
   */
  calcular: (cnpj: string): Promise<{ cnpj: string; resultados: Array<{ exercicio: number; indicadores: number; comDados: boolean }> }> =>
    api.post(`/analise-credito/empresas/${encodeURIComponent(cnpj)}/calcular`).then(r => r.data),

  /** Importa ECF para Parquet (P01) — necessário antes de calcular */
  dispararP01: (forcar = false) =>
    api.post('/analise-credito/p01/processar', undefined, {
      params: forcar ? { forcar: 'true' } : undefined,
    }).then(r => r.data),

  /** Apaga todos os dados calculados (ECF + indicadores + alertas) */
  resetarDados: (): Promise<{ mensagem: string; totais: Record<string, number> }> =>
    api.post('/analise-credito/admin/resetar').then(r => r.data),

  /** Força P01 + calcular para todas as empresas do tenant (reprocessamento completo) */
  reprocessarEcf: (): Promise<{ mensagem: string; status: string; total: number }> =>
    api.post('/analise-credito/admin/reprocessar-ecf').then(r => r.data),
};

/* ─── Regras de Crédito ────────────────────────────────────────────────────── */

export interface CreditoRegra {
  id:               string;
  codigoRegra:      string;
  nome:             string;
  descricao:        string | null;
  severidade:       'critico' | 'atencao' | 'positivo';
  indicador:        string;
  indicador2:       string | null;
  categoria:        string;
  threshold1:       number | null;
  threshold2:       number | null;
  templateMensagem: string;
  ativo:            boolean;
  ordem:            number;
}

export interface UpdateRegraPayload {
  nome?:             string;
  descricao?:        string;
  severidade?:       string;
  categoria?:        string;
  threshold1?:       number | null;
  threshold2?:       number | null;
  templateMensagem?: string;
  ativo?:            boolean;
}

export const regrasApi = {
  listar: (): Promise<CreditoRegra[]> =>
    api.get('/analise-credito/regras').then(r => r.data),

  atualizar: (id: string, payload: UpdateRegraPayload): Promise<CreditoRegra> =>
    api.patch(`/analise-credito/regras/${id}`, payload).then(r => r.data),

  toggle: (id: string): Promise<CreditoRegra> =>
    api.patch(`/analise-credito/regras/${id}/toggle`).then(r => r.data),
};
