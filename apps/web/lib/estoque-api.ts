import { api } from './api';

export interface CombustivelAnalisado {
  codItem: string;
  descricao: string;
  ncm: string;
  estqAbertura: number;
  entradas: number;
  vendas: number;
  perda: number;
  ganho: number;
  estqFechamento: number;
  perdaPercent: number;            // 0–1
  quebraLiquida: number;           // ganho − perda
  escrituralFechamento: number;
  divergenciaFisicoEscritural: number;
  giro: number;
  coberturaDias: number;
}

export interface CombustivelResposta {
  empresaId: string;
  cnpj: string;
  nome: string;
  ano: number;
  arquivos: number;
  dtIni: string;
  dtFin: string;
  temBloco1300: boolean;
  totalVendas: number;
  totalEntradas: number;
  totalPerda: number;
  totalGanho: number;
  perdaPercentGlobal: number;      // 0–1
  combustiveis: CombustivelAnalisado[];
  alertas: string[];
}

export const estoqueApi = {
  /** Estoque fiscal de combustível (Bloco 1300) — venda medida, perda e giro por combustível. */
  combustivel(params: { empresaId: string; ano: number }): Promise<CombustivelResposta> {
    return api.get('/estoque/combustivel', { params }).then(r => r.data);
  },
};
