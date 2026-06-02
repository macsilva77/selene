/**
 * P02 — Serviço de DRE
 * Fonte primária: ECF L300 (DRE referencial estruturado)
 * Fallback:       ECF L100 → ECD contas REC/CUS/DES
 *
 * Convenção de valores em tb_dre:
 *   Positivo = valor bruto da linha (sempre >= 0)
 *   A fórmula de cálculo é responsabilidade de quem lê tb_dre (P03/P05).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

export type LinhaDre =
  | 'receita_bruta' | 'deducoes' | 'receita_liquida'
  | 'cmv' | 'lucro_bruto'
  | 'desp_vendas' | 'desp_admin' | 'desp_financeiras'
  | 'rec_financeiras' | 'outras_desp' | 'outras_rec'
  | 'ebit' | 'depreciacao' | 'ebitda'
  | 'ir_csll' | 'lucro_liquido';

export interface DreRow {
  linhaDre: LinhaDre;
  valor:    Decimal;    // sempre positivo (magnitude)
  fonte:    string;
}

export interface DreResult {
  linhas:     DreRow[];
  completo:   boolean;   // false se faltam linhas essenciais
  fonteUsada: string;
  alertas:    string[];
}

// ─── Mapeamento de códigos L300 → linha DRE ───────────────────────────────────
// Usa o prefixo do código (menor nível sintético) para mapeamento robusto.
// O plano ECF referencial é padronizado pela RFB.
const L300_PREFIX_MAP: Array<{ prefixo: string; linha: LinhaDre }> = [
  { prefixo: '3.01.01.01.01', linha: 'receita_bruta'     },
  { prefixo: '3.01.01.01.02', linha: 'deducoes'           },
  { prefixo: '3.01.01.01',    linha: 'receita_liquida'    },
  { prefixo: '3.01.01.03',    linha: 'cmv'                },
  { prefixo: '3.01.01.04.01', linha: 'desp_vendas'        },
  { prefixo: '3.01.01.04.02', linha: 'desp_admin'         },
  { prefixo: '3.01.01.04.03', linha: 'outras_desp'        },
  { prefixo: '3.01.01.05.01', linha: 'rec_financeiras'    },
  { prefixo: '3.01.01.05.02', linha: 'desp_financeiras'   },
  { prefixo: '3.01.02',       linha: 'ir_csll'            },
  { prefixo: '3.01.03',       linha: 'ir_csll'            }, // CSLL → soma com IR
];

// Palavras-chave para classificação de contas ECD como fallback
const DRE_KEYWORDS: Record<LinhaDre, string[]> = {
  receita_bruta:    ['receita bruta', 'venda', 'prestacao servico', 'servico prestado'],
  deducoes:         ['deducao', 'devolucao', 'abatimento', 'imposto sobre venda'],
  receita_liquida:  ['receita liquida'],
  cmv:              ['custo mercadoria', 'custo produto', 'cmv', 'cpv', 'cst'],
  lucro_bruto:      ['lucro bruto'],
  desp_vendas:      ['despesa venda', 'despesa comercial'],
  desp_admin:       ['despesa administ', 'despesa geral', 'despesa operacional'],
  desp_financeiras: ['despesa financeira', 'juro pago', 'encargo financeiro'],
  rec_financeiras:  ['receita financeira', 'juro recebido', 'aplicacao financeira'],
  outras_desp:      ['outras despesas'],
  outras_rec:       ['outras receitas'],
  ebit:             [],
  depreciacao:      ['depreciacao', 'amortizacao', 'exaustao'],
  ebitda:           [],
  ir_csll:          ['imposto renda', 'irpj', 'csll', 'contribuicao social sobre lucro'],
  lucro_liquido:    ['lucro liquido', 'resultado liquido', 'resultado do periodo'],
};

function abs(d: Decimal): Decimal { return d.isNegative() ? d.negated() : d; }

@Injectable()
export class P02DreService {
  constructor(private readonly prisma: PrismaService) {}

  async montar(empresaId: string, exercicio: number): Promise<DreResult> {
    // Tenta L300 primeiro
    const l300 = await this.prisma.creditoEcfRegistro.findMany({
      where: { empresaId, exercicio, registroEcf: 'L300' },
    });

    if (l300.length > 0) {
      return this.montarDeL300(l300);
    }

    // Fallback: L100
    const l100 = await this.prisma.creditoEcfRegistro.findMany({
      where: { empresaId, exercicio, registroEcf: 'L100' },
    });
    if (l100.length > 0) {
      return this.montarDeL100(l100);
    }

    // Fallback final: ECD
    return this.montarDeEcd(empresaId, exercicio);
  }

  // ─── Fonte L300 ─────────────────────────────────────────────────────────────

  private montarDeL300(registros: { linhaCodigo: string; descricao: string; valor: Decimal }[]): DreResult {
    const alertas: string[] = [];

    // Acumuladores por linha_dre (usamos Map para somar caso venham múltiplos)
    const acc = new Map<LinhaDre, Decimal>();

    for (const r of registros) {
      const match = L300_PREFIX_MAP.find(m => r.linhaCodigo === m.prefixo);
      if (!match) continue;

      const existing = acc.get(match.linha) ?? new Decimal(0);
      acc.set(match.linha, existing.add(abs(r.valor)));
    }

    // lucro_liquido: L300 conta raiz (menor nível = codigo mais curto)
    if (!acc.has('lucro_liquido')) {
      const raiz = registros
        .filter(r => /^\d+$/.test(r.linhaCodigo))
        .sort((a, b) => a.linhaCodigo.localeCompare(b.linhaCodigo))[0];
      if (raiz) acc.set('lucro_liquido', abs(raiz.valor));
    }

    // Derivados calculados
    if (acc.has('receita_bruta') && acc.has('deducoes') && !acc.has('receita_liquida')) {
      acc.set('receita_liquida', acc.get('receita_bruta')!.minus(acc.get('deducoes')!).abs());
    }
    if (acc.has('receita_liquida') && acc.has('cmv') && !acc.has('lucro_bruto')) {
      acc.set('lucro_bruto', acc.get('receita_liquida')!.minus(acc.get('cmv')!));
    }

    // EBIT = lucro_líquido + IR/CSLL + juros_pagos - juros_recebidos
    this.calcularEbitEbitda(acc, registros, alertas);

    const linhas = [...acc.entries()].map(([linhaDre, valor]) => ({
      linhaDre, valor, fonte: 'ecf_l300' as string,
    }));

    const completo = acc.has('receita_liquida') && acc.has('lucro_liquido');
    return { linhas, completo, fonteUsada: 'ecf_l300', alertas };
  }

  // ─── Depreciação (M300/M350) ─────────────────────────────────────────────────

  private calcularEbitEbitda(
    acc: Map<LinhaDre, Decimal>,
    registros: { linhaCodigo: string; descricao: string; valor: Decimal }[],
    alertas: string[],
  ) {
    const lucroLiq  = acc.get('lucro_liquido')  ?? null;
    const irCsll    = acc.get('ir_csll')        ?? new Decimal(0);
    const despFin   = acc.get('desp_financeiras') ?? new Decimal(0);
    const recFin    = acc.get('rec_financeiras')  ?? new Decimal(0);

    if (lucroLiq !== null) {
      const ebit = lucroLiq.add(irCsll).add(despFin).minus(recFin);
      acc.set('ebit', ebit);

      // Depreciação: soma de M300 com descrição de depreciação
      const deprec = registros
        .filter(r => {
          const d = r.descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return d.includes('depreciac') || d.includes('amortizac') || d.includes('exaust');
        })
        .reduce((s, r) => s.add(abs(r.valor)), new Decimal(0));

      if (deprec.greaterThan(0)) {
        acc.set('depreciacao', deprec);
        acc.set('ebitda', ebit.add(deprec));
      } else {
        alertas.push('Depreciação não encontrada em M300/M350 — EBITDA = EBIT');
        acc.set('depreciacao', new Decimal(0));
        acc.set('ebitda', ebit);
      }
    }
  }

  // ─── Fonte L100 ─────────────────────────────────────────────────────────────

  private montarDeL100(registros: { linhaCodigo: string; descricao: string; valor: Decimal }[]): DreResult {
    const alertas = ['DRE montada de L100 (balanço referencial) por ausência de L300'];
    const acc = new Map<LinhaDre, Decimal>();

    for (const r of registros) {
      const desc = r.descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const [linha, palavras] of Object.entries(DRE_KEYWORDS) as [LinhaDre, string[]][]) {
        if (palavras.some(p => desc.includes(p))) {
          const existing = acc.get(linha) ?? new Decimal(0);
          acc.set(linha, existing.add(abs(r.valor)));
          break;
        }
      }
    }

    const linhas = [...acc.entries()].map(([linhaDre, valor]) => ({
      linhaDre, valor, fonte: 'ecf_l100' as string,
    }));

    return { linhas, completo: acc.has('receita_liquida'), fonteUsada: 'ecf_l100', alertas };
  }

  // ─── Fallback ECD ────────────────────────────────────────────────────────────

  private async montarDeEcd(empresaId: string, exercicio: number): Promise<DreResult> {
    const alertas = ['DRE inferida de contas ECD por ausência de ECF (L300/L100)'];
    const acc = new Map<LinhaDre, Decimal>();

    const saldos = await this.prisma.creditoEcdSaldo.findMany({
      where: { empresaId, exercicio, grupo: { in: ['REC', 'CUS', 'DES', 'RNO'] } },
    });

    for (const s of saldos) {
      const desc = s.contaNome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      let linha: LinhaDre | null = null;

      if (s.grupo === 'REC')    linha = 'receita_bruta';
      else if (s.grupo === 'CUS') linha = 'cmv';
      else if (s.grupo === 'DES') {
        if (DRE_KEYWORDS.depreciacao.some(p => desc.includes(p))) linha = 'depreciacao';
        else if (DRE_KEYWORDS.desp_financeiras.some(p => desc.includes(p))) linha = 'desp_financeiras';
        else if (DRE_KEYWORDS.rec_financeiras.some(p => desc.includes(p))) linha = 'rec_financeiras';
        else linha = 'desp_admin';
      } else if (s.grupo === 'RNO') {
        linha = desc.includes('receita') ? 'outras_rec' : 'outras_desp';
      }

      if (linha) {
        const existing = acc.get(linha) ?? new Decimal(0);
        acc.set(linha, existing.add(abs(s.saldoFinal)));
      }
    }

    if (acc.has('receita_bruta') && !acc.has('receita_liquida')) {
      acc.set('receita_liquida', acc.get('receita_bruta')!);
    }
    if (acc.has('receita_liquida') && acc.has('cmv')) {
      acc.set('lucro_bruto', acc.get('receita_liquida')!.minus(acc.get('cmv')!));
    }

    const linhas = [...acc.entries()].map(([linhaDre, valor]) => ({
      linhaDre, valor, fonte: 'ecd_inferido' as string,
    }));

    return { linhas, completo: acc.has('receita_liquida'), fonteUsada: 'ecd_inferido', alertas };
  }
}
