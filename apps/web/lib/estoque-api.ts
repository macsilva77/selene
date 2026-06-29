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

/* ─── Estoque fiscal (Bloco H + C170) ──────────────────────────────────────── */

export interface IndiceEstoque {
  codigos: number;
  qtd: number;
  valor: number;
}

export interface ItemReconciliado {
  codItem: string;
  descricao: string;
  ncm: string;
  unid: string;
  eiQtd: number; eiVal: number;
  comprasQtd: number; comprasVal: number;
  vendasQtd: number; vendasVal: number;
  efQtd: number; efVal: number;
  efCalcQtd: number;
  giro: number;
  estouro: boolean;
  estouroQtd: number; estouroVal: number;
  semEi: boolean; semEf: boolean; semCompra: boolean; semVenda: boolean;
  movSemEi: boolean; movSemEf: boolean; estanque: boolean;
}

export interface FaixaPropriedade {
  valor: number;
  qtdItens: number;
  percValor: number;               // 0–1
}

export interface AnaliseFinal {
  dtInv: string;
  motInvLabel: string;
  valorTotal: number;
  qtdItens: number;
  qtdItensDistintos: number;
  propriedade: {
    proprioEmPoder: FaixaPropriedade;
    proprioEmTerceiro: FaixaPropriedade;
    terceiroEmPoder: FaixaPropriedade;
  };
  estoqueConciliavel: number;
  integridade: { vlInvDeclarado: number; somaCalculada: number; diferenca: number; ok: boolean };
  alertas: string[];
}

export interface EstoqueFiscalResposta {
  empresaId: string;
  nome: string;
  cnpj: string;
  ano: number;
  modo: 'MEDIDO' | 'DERIVADO';
  dtEstoqueInicial: string;
  dtEstoqueFinal: string;
  temFotoInicial: boolean;
  temFotoFinal: boolean;
  arquivosMovimento: number;
  indices: {
    estoqueInicial: IndiceEstoque;
    comprados: IndiceEstoque;
    vendidos: IndiceEstoque;
    estoqueFinal: IndiceEstoque;
    movimentados: IndiceEstoque;
  };
  giroTotal: number;
  pontosAtencao: {
    semCompra: IndiceEstoque;
    semVenda: IndiceEstoque;
    movSemEi: IndiceEstoque;
    movSemEf: IndiceEstoque;
    estouro: ItemReconciliado[];
  };
  itens: ItemReconciliado[];
  analiseFinal: AnaliseFinal | null;
}

export const estoqueApi = {
  /** Estoque fiscal de combustível (Bloco 1300) — venda medida, perda e giro por combustível. */
  combustivel(params: { empresaId: string; ano: number }): Promise<CombustivelResposta> {
    return api.get('/estoque/combustivel', { params }).then(r => r.data);
  },

  /** Estoque fiscal (Bloco H + C170) — reconciliação por item, índices, giro e pontos de atenção. */
  fiscal(params: { empresaId: string; ano: number }): Promise<EstoqueFiscalResposta> {
    return api.get('/estoque/fiscal', { params }).then(r => r.data);
  },
};
