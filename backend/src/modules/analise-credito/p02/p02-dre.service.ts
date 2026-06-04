/**
 * P02 — Serviço de DRE
 * Fonte primária: ECF L300/P150/U150 (regime-aware), depois ECD.
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

// ─── Mapeamento de prefixos L300 → linha DRE ─────────────────────────────────
// Plano Referencial RFB para Lucro Real (L300).
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

// Palavras-chave para P150/U150 e fallback ECD (descrições padronizadas RFB)
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

  /**
   * Monta a DRE com prioridade: ECF (regime-aware: L300/P150/U150) → ECD inferido.
   * Nunca usa L100 (BP) como fonte de DRE.
   */
  async montar(
    empresaId: string,
    exercicio: number,
    regimeTributario?: string | null,
  ): Promise<DreResult> {
    const candidatos = this.candidatosDre(regimeTributario);

    for (const registroEcf of candidatos) {
      const registros = await this.prisma.creditoEcfRegistro.findMany({
        where: { empresaId, exercicio, registroEcf },
      });
      if (registros.length === 0) continue;

      if (registroEcf === 'L300') return this.montarDeL300(registros);
      // P150 e U150 têm estrutura diferente do L300 mas descrições padronizadas RFB
      return this.montarDeEcfKeywords(registros, registroEcf);
    }

    // Último recurso: ECD (contas de resultado inferidas por grupo/palavra-chave)
    return this.montarDeEcd(empresaId, exercicio);
  }

  // ─── Ordem de candidatos por regime ─────────────────────────────────────────

  private candidatosDre(regime: string | null | undefined): string[] {
    const MAPA: Record<string, string[]> = {
      lucro_real:       ['L300', 'P150', 'U150'],
      lucro_presumido:  ['P150', 'L300', 'U150'],
      lucro_arbitrado:  ['P150', 'L300', 'U150'],
      imune_isenta:     ['U150', 'L300', 'P150'],
      simples_nacional: ['P150', 'L300', 'U150'],
    };
    return MAPA[regime ?? ''] ?? ['L300', 'P150', 'U150'];
  }

  // ─── Fonte L300 (Lucro Real — mapeamento por prefixo de código) ──────────────

  private montarDeL300(registros: { linhaCodigo: string; descricao: string; valor: Decimal }[]): DreResult {
    const alertas: string[] = [];
    const acc = new Map<LinhaDre, Decimal>();

    for (const r of registros) {
      const match = L300_PREFIX_MAP.find(m => r.linhaCodigo.startsWith(m.prefixo));
      if (!match) continue;
      acc.set(match.linha, (acc.get(match.linha) ?? new Decimal(0)).add(abs(r.valor)));
    }

    // lucro_liquido: nó raiz (menor quantidade de segmentos)
    if (!acc.has('lucro_liquido')) {
      const raiz = [...registros].sort((a, b) => {
        const la = a.linhaCodigo.split('.').length;
        const lb = b.linhaCodigo.split('.').length;
        return la === lb ? a.linhaCodigo.localeCompare(b.linhaCodigo) : la - lb;
      })[0];
      if (raiz) acc.set('lucro_liquido', abs(raiz.valor));
    }

    if (acc.has('receita_bruta') && acc.has('deducoes') && !acc.has('receita_liquida')) {
      acc.set('receita_liquida', acc.get('receita_bruta')!.minus(acc.get('deducoes')!).abs());
    }
    if (acc.has('receita_liquida') && acc.has('cmv') && !acc.has('lucro_bruto')) {
      acc.set('lucro_bruto', acc.get('receita_liquida')!.minus(acc.get('cmv')!));
    }

    this.calcularEbitEbitda(acc, registros, alertas);

    const linhas = [...acc.entries()].map(([linhaDre, valor]) => ({ linhaDre, valor, fonte: 'ecf_l300' }));
    return { linhas, completo: acc.has('receita_liquida') && acc.has('lucro_liquido'), fonteUsada: 'ecf_l300', alertas };
  }

  // ─── Fonte P150 / U150 (mapeamento por palavras-chave nas descrições RFB) ───

  private montarDeEcfKeywords(
    registros: { linhaCodigo: string; descricao: string; valor: Decimal }[],
    registroEcf: string,
  ): DreResult {
    const alertas: string[] = [];
    const acc = new Map<LinhaDre, Decimal>();

    for (const r of registros) {
      const desc = r.descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const [linha, palavras] of Object.entries(DRE_KEYWORDS) as [LinhaDre, string[]][]) {
        if (palavras.some(p => desc.includes(p))) {
          acc.set(linha, (acc.get(linha) ?? new Decimal(0)).add(abs(r.valor)));
          break;
        }
      }
    }

    this.derivarLucroLiquido(acc, alertas);
    this.calcularEbitEbitda(acc, registros, alertas);

    const fonte = `ecf_${registroEcf.toLowerCase()}`;
    const linhas = [...acc.entries()].map(([linhaDre, valor]) => ({ linhaDre, valor, fonte }));
    return { linhas, completo: acc.has('receita_liquida'), fonteUsada: fonte, alertas };
  }

  // ─── EBIT / EBITDA ───────────────────────────────────────────────────────────

  private calcularEbitEbitda(
    acc: Map<LinhaDre, Decimal>,
    registros: { linhaCodigo: string; descricao: string; valor: Decimal }[],
    alertas: string[],
  ) {
    const lucroLiq = acc.get('lucro_liquido') ?? null;
    if (lucroLiq === null) return;

    const irCsll  = acc.get('ir_csll')         ?? new Decimal(0);
    const despFin = acc.get('desp_financeiras') ?? new Decimal(0);
    const recFin  = acc.get('rec_financeiras')  ?? new Decimal(0);
    const ebit    = lucroLiq.add(irCsll).add(despFin).minus(recFin);
    acc.set('ebit', ebit);

    let deprec = acc.get('depreciacao') ?? new Decimal(0);
    if (deprec.isZero()) {
      deprec = registros
        .filter(r => {
          const d = r.descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return d.includes('depreciac') || d.includes('amortizac') || d.includes('exaust');
        })
        .reduce((s, r) => s.add(abs(r.valor)), new Decimal(0));
    }

    if (deprec.greaterThan(0)) {
      acc.set('depreciacao', deprec);
      acc.set('ebitda', ebit.add(deprec));
    } else {
      alertas.push('Depreciação não encontrada — EBITDA = EBIT');
      acc.set('depreciacao', new Decimal(0));
      acc.set('ebitda', ebit);
    }
  }

  private derivarLucroLiquido(acc: Map<LinhaDre, Decimal>, alertas: string[]) {
    if (acc.has('lucro_liquido')) return;
    const rl = acc.get('receita_liquida') ?? new Decimal(0);
    if (rl.isZero()) return;
    const cmv = acc.get('cmv')              ?? new Decimal(0);
    const dA  = acc.get('desp_admin')       ?? new Decimal(0);
    const dV  = acc.get('desp_vendas')      ?? new Decimal(0);
    const dep = acc.get('depreciacao')      ?? new Decimal(0);
    const dF  = acc.get('desp_financeiras') ?? new Decimal(0);
    const rF  = acc.get('rec_financeiras')  ?? new Decimal(0);
    const oD  = acc.get('outras_desp')      ?? new Decimal(0);
    const oR  = acc.get('outras_rec')       ?? new Decimal(0);
    const ir  = acc.get('ir_csll')          ?? new Decimal(0);
    acc.set('lucro_liquido',
      rl.minus(cmv).minus(dA).minus(dV).minus(dep)
        .minus(dF).add(rF).minus(oD).add(oR).minus(ir));
    alertas.push('lucro_liquido derivado (linha direta não identificada)');
  }

  // ─── Fallback ECD ────────────────────────────────────────────────────────────

  private classificarSaldoEcd(grupo: string, desc: string): LinhaDre | null {
    if (grupo === 'REC') return 'receita_bruta';
    if (grupo === 'CUS') return 'cmv';
    if (grupo === 'RNO') return desc.includes('receita') ? 'outras_rec' : 'outras_desp';
    if (grupo !== 'DES') return null;
    if (DRE_KEYWORDS.depreciacao.some(p => desc.includes(p)))      return 'depreciacao';
    if (DRE_KEYWORDS.desp_financeiras.some(p => desc.includes(p))) return 'desp_financeiras';
    if (DRE_KEYWORDS.rec_financeiras.some(p => desc.includes(p)))  return 'rec_financeiras';
    return 'desp_admin';
  }

  private async montarDeEcd(empresaId: string, exercicio: number): Promise<DreResult> {
    const alertas = ['DRE inferida de contas ECD — ECF L300/P150/U150 não encontrado'];
    const acc = new Map<LinhaDre, Decimal>();

    const saldos = await this.prisma.creditoEcdSaldo.findMany({
      where: { empresaId, exercicio, grupo: { in: ['REC', 'CUS', 'DES', 'RNO'] } },
    });

    for (const s of saldos) {
      const desc  = s.contaNome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const linha = this.classificarSaldoEcd(s.grupo, desc);
      if (linha) acc.set(linha, (acc.get(linha) ?? new Decimal(0)).add(abs(s.saldoFinal)));
    }

    if (acc.has('receita_bruta') && !acc.has('receita_liquida')) {
      acc.set('receita_liquida', acc.get('receita_bruta')!);
    }
    if (acc.has('receita_liquida') && acc.has('cmv')) {
      acc.set('lucro_bruto', acc.get('receita_liquida')!.minus(acc.get('cmv')!));
    }

    this.derivarLucroLiquido(acc, alertas);
    this.calcularEbitEbitda(acc, [], alertas);

    const linhas = [...acc.entries()].map(([linhaDre, valor]) => ({ linhaDre, valor, fonte: 'ecd_inferido' }));
    return { linhas, completo: acc.has('receita_liquida'), fonteUsada: 'ecd_inferido', alertas };
  }
}
