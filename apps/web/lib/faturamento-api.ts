import { api } from './api';

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

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

export interface EmpresaFaturamento {
  id:           string;
  cnpj:         string;
  nome:         string;
  nomeFantasia: string | null;
}

/* ─── API ────────────────────────────────────────────────────────────────── */

export const faturamentoApi = {
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

  listarEmpresas(): Promise<EmpresaFaturamento[]> {
    return api.get('/empresas', { params: { limit: 500, ativo: true } })
      .then(r => (r.data?.data ?? r.data) as EmpresaFaturamento[]);
  },
};
