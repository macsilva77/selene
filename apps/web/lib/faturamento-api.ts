import { api } from './api';

/* ─── Tipos base ─────────────────────────────────────────────────────────── */

export interface FaturamentoMensal {
  mes:                  number;
  vlFaturamentoBruto:   number;
  vlComprasBruto:       number;
  vlIcms:               number;
  vlIpi:                number;
  vlPis:                number;
  vlCofins:             number;
  qtdDocumentos:        number;
}

export interface FaturamentoAnual {
  cnpj:                  string;
  ano:                   number;
  fonte:                 string;
  totalFaturamentoBruto: number;
  totalComprasBruto:     number;
  totalIcms:             number;
  totalIpi:              number;
  totalPis:              number;
  totalCofins:           number;
  totalDocumentos:       number;
  mesesProcessados:      number;
  mensal:                FaturamentoMensal[];
}

/* ─── Consolidado simples (sem CFOP) ─────────────────────────────────────── */

export interface FaturamentoConsolidadoAno {
  ano:                  number;
  vlFaturamentoBruto:   number;
  vlComprasBruto:       number;
  vlIcms:               number;
  vlIpi:                number;
  vlPis:                number;
  vlCofins:             number;
  qtdDocumentos:        number;
  qtdDocumentosCompras: number;
  mesesProcessados:     number;
}

export interface FaturamentoConsolidado {
  empresaId: string;
  cnpj:      string;
  nome:      string;
  fonte:     string;
  anoInicio: number;
  anoFim:    number;
  anos:      FaturamentoConsolidadoAno[];
}

/* ─── Consolidado com breakdown CFOP ─────────────────────────────────────── */

export interface FaturamentoCfopsAno {
  ano:                  number;
  vlFaturamentoBruto:   number;
  vlComprasBruto:       number;
  vlIcms:               number;
  qtdDocumentos:        number;
  qtdDocumentosCompras: number;
  mesesProcessados:     number;
  // Categorias CFOP
  vlEstaduais:          number;
  vlInterestaduais:     number;
  vlExportacoes:        number;
  vlDevolucoes:         number;
  vlTransferencias:     number;
  vlRemessas:           number;
  // Calculados
  vlMercadorias:        number;
  vlFatLiquido:         number;
  // Índices (0–1)
  idxEstadual:          number;
  idxInterestadual:     number;
  idxExportacao:        number;
  idxDevolucao:         number;
}

export interface FaturamentoCfopsConsolidado {
  empresaId: string;
  cnpj:      string;
  nome:      string;
  fonte:     string;
  anoInicio: number;
  anoFim:    number;
  anos:      FaturamentoCfopsAno[];
}

/* ─── Empresa ────────────────────────────────────────────────────────────── */

export interface EmpresaFaturamento {
  id:           string;
  cnpj:         string;
  nome:         string;
  nomeFantasia: string | null;
}

/* ─── Processamento ──────────────────────────────────────────────────────── */

export interface ResultadoProcessamento {
  cnpj:               string;
  competencia:        string;
  vlFaturamentoBruto: number;
  vlIcms:             number;
  vlIpi:              number;
  qtdDocumentos:      number;
  qtdCfops:           number;
}

export interface ResultadoProcessamentoContrib {
  cnpj:                  string;
  competencia:           string;
  vlServicos:            number;
  vlPis:                 number;
  vlCofins:              number;
  qtdDocumentosServicos: number;
  mesclado:              boolean;
}

export interface RespostaProcessarLote {
  processados: number;
  resultados:  ResultadoProcessamento[];
}

export interface RespostaProcessarContribLote {
  processados: number;
  resultados:  ResultadoProcessamentoContrib[];
}

/* ─── API ────────────────────────────────────────────────────────────────── */

export const faturamentoApi = {
  processar(params?: { ano?: number }): Promise<RespostaProcessarLote> {
    return api.post('/faturamento/processar', params ?? {}).then(r => r.data);
  },

  processarContrib(params?: { ano?: number }): Promise<RespostaProcessarContribLote> {
    return api.post('/faturamento/processar-contrib', params ?? {}).then(r => r.data);
  },

  anual(params: { cnpj: string; ano: number; fonte?: string }): Promise<FaturamentoAnual> {
    return api.get('/faturamento/anual', {
      params: { cnpj: params.cnpj, ano: params.ano, fonte: params.fonte ?? 'AMBOS' },
    }).then(r => r.data);
  },

  consolidado(params: {
    empresaId:  string;
    anoInicio?: number;
    anoFim?:    number;
    fonte?:     string;
  }): Promise<FaturamentoConsolidado> {
    return api.get('/faturamento/consolidado', { params }).then(r => r.data);
  },

  cfopsConsolidado(params: {
    empresaId:  string;
    anoInicio?: number;
    anoFim?:    number;
    fonte?:     string;
  }): Promise<FaturamentoCfopsConsolidado> {
    return api.get('/faturamento/cfops-consolidado', { params }).then(r => r.data);
  },

  listarEmpresas(): Promise<EmpresaFaturamento[]> {
    return api.get('/empresas', { params: { limit: 500, ativo: true } })
      .then(r => (r.data?.data ?? r.data) as EmpresaFaturamento[]);
  },
};
