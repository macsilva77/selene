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
  id:          string;
  cnpj:        string;
  nome:        string;
  nomeFantasia: string | null;
}

/* ─── API ────────────────────────────────────────────────────────────────── */

export const faturamentoApi = {
  anual(params: { cnpj: string; ano: number; fonte?: string }): Promise<FaturamentoAnual> {
    const qs = new URLSearchParams({
      cnpj:  params.cnpj,
      ano:   String(params.ano),
      fonte: params.fonte ?? 'AMBOS',
    });
    return api.get<FaturamentoAnual>(`/faturamento/anual?${qs}`);
  },

  consolidado(params: {
    empresaId:  string;
    anoInicio?: number;
    anoFim?:    number;
    fonte?:     string;
  }): Promise<FaturamentoConsolidado> {
    const qs = new URLSearchParams({ empresaId: params.empresaId });
    if (params.anoInicio) qs.set('anoInicio', String(params.anoInicio));
    if (params.anoFim)    qs.set('anoFim',    String(params.anoFim));
    if (params.fonte)     qs.set('fonte',     params.fonte);
    return api.get<FaturamentoConsolidado>(`/faturamento/consolidado?${qs}`);
  },

  async listarEmpresas(): Promise<EmpresaFaturamento[]> {
    const resp = await api.get<{ data: EmpresaFaturamento[] }>('/empresas?limit=500&ativo=true');
    return resp.data ?? [];
  },
};
