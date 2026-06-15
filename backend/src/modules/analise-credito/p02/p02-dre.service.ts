/**
 * P02 — Serviço de DRE
 * Fonte primária: ECF L300/P150/U150 (regime-aware), depois ECD.
 *
 * Convenção de valores em tb_dre:
 *   Positivo = valor bruto da linha (sempre >= 0)
 *   A fórmula de cálculo é responsabilidade de quem lê tb_dre (P03/P05).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { EcfDataSourceService } from '../infrastructure/ecf-data-source.service';
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
  linhas:      DreRow[];
  completo:    boolean;   // false se faltam linhas essenciais
  fonteUsada:  string;
  alertas:     string[];
  validacaoOk: boolean;   // false = NÃO publicar indicadores (ver alertas)
}

// ─── Mapeamento de prefixos L300 → linha DRE ─────────────────────────────────
// Plano Referencial RFB para Lucro Real (L300).
// ORDENADO do mais específico para o menos específico: find() retorna o primeiro
// match, que será sempre o prefixo mais longo (longest-prefix-match).
const L300_PREFIX_MAP: Array<{ prefixo: string; linha: LinhaDre }> = [
  // ── Nível 6 (mais específico) ────────────────────────────────────────────────
  { prefixo: '3.01.01.09.01.08', linha: 'desp_financeiras' }, // Outras Desp. Financeiras
  // ── Nível 5 ──────────────────────────────────────────────────────────────────
  { prefixo: '3.01.01.01.01',    linha: 'receita_bruta'    }, // Receita Bruta
  { prefixo: '3.01.01.01.02',    linha: 'deducoes'          }, // Deduções da RB
  { prefixo: '3.01.01.04.01',    linha: 'desp_vendas'       }, // Desp. Vendas (plano compacto)
  { prefixo: '3.01.01.04.02',    linha: 'desp_admin'        }, // Desp. Adm (plano compacto)
  { prefixo: '3.01.01.04.03',    linha: 'outras_desp'       }, // Outras Desp (plano compacto)
  { prefixo: '3.01.01.05.01',    linha: 'outras_rec'        }, // Outras Rec Op (plano compacto)
  { prefixo: '3.01.01.05.02',    linha: 'desp_financeiras'  }, // Desp. Fin (plano compacto)
  // ── Nível 4 (plano expandido RFB — maioria das Lucro Real) ───────────────────
  { prefixo: '3.01.01.01',       linha: 'receita_liquida'  }, // Receita Líquida
  { prefixo: '3.01.01.03',       linha: 'cmv'              }, // Custo dos Bens e Serviços
  { prefixo: '3.01.01.05',       linha: 'outras_rec'       }, // Outras Receitas Operacionais
  { prefixo: '3.01.01.07',       linha: 'desp_admin'       }, // Despesas Operacionais
  { prefixo: '3.01.01.09',       linha: 'outras_desp'      }, // Outras Desp. Operacionais
  // ── Nível 3 ──────────────────────────────────────────────────────────────────
  { prefixo: '3.01.02',          linha: 'ir_csll'          }, // IR
  { prefixo: '3.01.03',          linha: 'ir_csll'          }, // CSLL → soma com IR
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
  private readonly logger = new Logger(P02DreService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly ecfDataSource: EcfDataSourceService,
  ) {}

  /**
   * Monta a DRE com prioridade: ECF (regime-aware: L300/P150/U150) → ECD inferido.
   * EcfDataSource roteia: Parquet (novo) → banco relacional (fallback legado).
   */
  async montar(
    empresaId: string,
    exercicio: number,
    regimeTributario?: string | null,
    trimestre?: number,
  ): Promise<DreResult> {
    const candidatos = this.candidatosDre(regimeTributario);

    for (const registroEcf of candidatos) {
      const rows = await this.ecfDataSource.consultar(empresaId, exercicio, { registroEcf, trimestre });
      this.logger.log(`[DIAG-DRE] empresaId=${empresaId} exercicio=${exercicio} trimestre=${trimestre ?? 'n/a'} registroEcf=${registroEcf} rows=${rows.length}`);
      if (rows.length === 0) continue;

      // Mapeia para o formato interno (valor como Decimal)
      const registros = rows.map(r => ({
        linhaCodigo:   r.linhaCodigo,
        descricao:     r.descricao,
        valor:         new Decimal(r.valor),
        naturezaFinal: r.naturezaFinal,  // 'C'=crédito/receita | 'D'=débito/despesa
      }));

      if (registroEcf === 'L300') return this.montarDeL300(registros, empresaId, exercicio);
      return this.montarDeEcfKeywords(registros, registroEcf);
    }

    this.logger.log(`[DIAG-DRE] empresaId=${empresaId} exercicio=${exercicio} → fallback ECD`);
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

  private montarDeL300(
    registros: { linhaCodigo: string; descricao: string; valor: Decimal; naturezaFinal: string }[],
    diagEmpresaId = '',
    diagExercicio = 0,
  ): DreResult {
    const alertas: string[] = [];

    // Derivar S/A: conta é folha (analítica) se nenhuma outra começa com cod + '.'
    // O '.' literal evita confundir 3.01.01.1 com 3.01.01.10.
    const todosCodigos = new Set(registros.map(r => r.linhaCodigo));
    const isFolha = (cod: string): boolean => {
      for (const outro of todosCodigos) {
        if (outro !== cod && outro.startsWith(cod + '.')) return false;
      }
      return true;
    };

    // Longest-prefix-match sobre folhas: L300_PREFIX_MAP está ordenado do mais
    // específico para o menos específico — find() retorna o primeiro (mais longo).
    const acc = new Map<LinhaDre, Decimal>();
    const naoClassificados: Array<{ cod: string; valor: Decimal; desc: string }> = [];

    for (const r of registros) {
      if (!isFolha(r.linhaCodigo)) continue;
      const match = L300_PREFIX_MAP.find(m => r.linhaCodigo.startsWith(m.prefixo));
      if (!match) {
        naoClassificados.push({ cod: r.linhaCodigo, valor: r.valor, desc: r.descricao });
        continue;
      }
      acc.set(match.linha, (acc.get(match.linha) ?? new Decimal(0)).add(abs(r.valor)));
    }

    // Débito 3: D&A folhas-only — evita dupla contagem quando nó sintético e folha
    // compartilham descrição similar (ex: "Deprec. e Amort." pai + "Deprec. Equip." filho).
    // Log [DA-ORIGEM] expõe os códigos referenciais reais para futura migração por código.
    if (!acc.has('depreciacao') || acc.get('depreciacao')!.isZero()) {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const folhasDA = registros.filter(r => {
        if (!isFolha(r.linhaCodigo)) return false;
        const d = norm(r.descricao);
        return d.includes('depreciac') || d.includes('amortizac') || d.includes('exaust');
      });
      if (folhasDA.length > 0) {
        const totalDA = folhasDA.reduce((s, r) => s.add(abs(r.valor)), new Decimal(0));
        acc.set('depreciacao', totalDA);
        const codigos = folhasDA.map(r => r.linhaCodigo).join(',');
        this.logger.log(
          `[DA-ORIGEM] dep_amort_origem=heuristica empresaId=${diagEmpresaId} ` +
          `exercicio=${diagExercicio} total=${totalDA.toFixed(0)} codigos=${codigos}`,
        );
        alertas.push(`D&A por heurística de descrição: ${codigos}`);
      }
    }

    // A2 — LOG: natureza D/C de cada folha classificada (confirma que IND_DC real chega corretamente)
    // naturezaFinal vem de campos[8] no parser (Parquet) ou é 'D' hardcoded (fallback DB legado).
    this.logger.log(
      `[DIAG-DRE] L300 buckets (empresaId=${diagEmpresaId} exercicio=${diagExercicio}):\n` +
      (acc.size > 0
        ? [...acc.entries()].map(([l, v]) => `  ${l.padEnd(20)} = ${v.toFixed(2)}`).join('\n')
        : '  (nenhum match)') +
      (naoClassificados.length
        ? `\n  NAO_CLASS (${naoClassificados.length}):\n` +
          naoClassificados.map(x => `    ${x.cod.padEnd(28)} ${x.valor.toFixed(2).padStart(16)} | ${x.desc.slice(0, 40)}`).join('\n')
        : '') +
      `\n  [A2-natureza] amostra (primeiras 5 folhas):\n` +
      registros
        .filter(r => isFolha(r.linhaCodigo))
        .slice(0, 5)
        .map(r => `    ${r.linhaCodigo.padEnd(28)} nat=${r.naturezaFinal} val=${r.valor.toFixed(2).padStart(16)}`)
        .join('\n'),
    );

    // lucro_liquido: nó raiz da DRE (sintético — intencionalmente não é folha)
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
    if (acc.has('receita_liquida') && !acc.has('lucro_bruto')) {
      const cmv = acc.get('cmv') ?? new Decimal(0);
      acc.set('lucro_bruto', acc.get('receita_liquida')!.minus(cmv));
    }

    if (naoClassificados.length > 0) {
      alertas.push(`${naoClassificados.length} folha(s) L300 não classificadas: ${naoClassificados.slice(0, 3).map(x => x.cod).join(', ')}`);
    }

    this.calcularEbitEbitda(acc, registros, alertas);

    // A3 — verificação hierárquica (alerta, não aborta)
    this.verificarHierarquia(registros, isFolha, alertas);

    // B + C — reconciliação e invariantes (aborta se falhar)
    const naoClassTotal = naoClassificados.reduce((s, x) => s.add(abs(x.valor)), new Decimal(0));
    const reconciliaOk = this.verificarReconciliacao(acc, alertas);
    const invariantesOk = this.verificarInvariantes(acc, naoClassTotal, alertas);
    const validacaoOk = reconciliaOk && invariantesOk;

    if (!validacaoOk) {
      this.logger.warn(
        `[VALID-DRE] empresaId=${diagEmpresaId} exercicio=${diagExercicio} FALHOU — indicadores não serão publicados:\n` +
        alertas.filter(a => a.startsWith('[VALID')).map(a => `  ${a}`).join('\n'),
      );
    }

    const linhas = [...acc.entries()].map(([linhaDre, valor]) => ({ linhaDre, valor, fonte: 'ecf_l300' }));
    return {
      linhas,
      completo:    acc.has('receita_liquida') && acc.has('lucro_liquido'),
      fonteUsada:  'ecf_l300',
      alertas,
      validacaoOk,
    };
  }

  // ─── Fonte P150 / U150 (mapeamento por palavras-chave nas descrições RFB) ───

  private montarDeEcfKeywords(
    registros: { linhaCodigo: string; descricao: string; valor: Decimal; naturezaFinal: string }[],
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
    return { linhas, completo: acc.has('receita_liquida'), fonteUsada: fonte, alertas, validacaoOk: true };
  }

  // ─── EBIT / EBITDA ───────────────────────────────────────────────────────────

  private calcularEbitEbitda(
    acc: Map<LinhaDre, Decimal>,
    registros: { descricao: string; valor: Decimal }[],
    alertas: string[],
  ) {
    // Depreciação: mapa ou busca por descrição
    let deprec = acc.get('depreciacao') ?? new Decimal(0);
    if (deprec.isZero()) {
      deprec = registros
        .filter(r => {
          const d = r.descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return d.includes('depreciac') || d.includes('amortizac') || d.includes('exaust');
        })
        .reduce((s, r) => s.add(abs(r.valor)), new Decimal(0));
    }
    if (deprec.greaterThan(0)) acc.set('depreciacao', deprec);
    else acc.set('depreciacao', new Decimal(0));

    // Despesas financeiras: fallback por descrição quando o prefixo 3.01.01.05.02 não encontrou nada.
    // null (ausente) é diferente de 0 (empresa sem dívida); se o fallback também não achar,
    // cobertura_juros permanece null — nunca exibir 0 como se não houvesse despesa financeira.
    if (!acc.has('desp_financeiras') || acc.get('desp_financeiras')!.isZero()) {
      const despFinDesc = registros
        .filter(r => {
          const d = r.descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return d.includes('despesa financeira') || d.includes('juro pago') ||
                 d.includes('encargo financeiro') || d.includes('juros sobre emprestimo') ||
                 d.includes('juros e encargos');
        })
        .reduce((s, r) => s.add(abs(r.valor)), new Decimal(0));
      if (despFinDesc.greaterThan(0)) acc.set('desp_financeiras', despFinDesc);
      // Se ainda não encontrado, mantém ausente (não seta zero) para que cobertura_juros fique null
    }

    // LOG DIAG: estado do acc antes de calcular EBIT/EBITDA
    this.logger.log(
      `[DIAG-DRE] acc pré-ebitda:\n` +
      [...acc.entries()].map(([k, v]) => `  ${k.padEnd(20)} = ${v.toFixed(2)}`).join('\n') +
      `\n  deprec=${deprec.toFixed(2)}`,
    );

    // ── Caminho primário: top-down a partir da Receita Líquida ────────────────
    // Despesas operacionais (desp_admin + outras_desp) já incluem D&A.
    // EBIT = RL − CMV − DespOp + OutrasRec  (D&A embutida, sem deduzi-la separado)
    // EBITDA = EBIT + deprec  (add-back D&A encontrado por descrição)
    const rl = acc.get('receita_liquida');
    if (rl?.greaterThan(0)) {
      const cmv = acc.get('cmv')           ?? new Decimal(0);
      const dV  = acc.get('desp_vendas')   ?? new Decimal(0);
      const dA  = acc.get('desp_admin')    ?? new Decimal(0);
      const oD  = acc.get('outras_desp')   ?? new Decimal(0);
      const oR  = acc.get('outras_rec')    ?? new Decimal(0);
      const ebit   = rl.minus(cmv).minus(dV).minus(dA).minus(oD).add(oR);
      const ebitda = ebit.add(deprec);
      acc.set('ebit',   ebit);
      acc.set('ebitda', ebitda);
      if (!deprec.greaterThan(0)) alertas.push('Depreciação não encontrada — EBITDA = EBIT');
      return;
    }

    // ── Fallback: add-back a partir do Lucro Líquido ──────────────────────────
    const lucroLiq = acc.get('lucro_liquido') ?? null;
    if (lucroLiq === null) return;

    const irCsll  = acc.get('ir_csll')         ?? new Decimal(0);
    const despFin = acc.get('desp_financeiras') ?? new Decimal(0);
    const recFin  = acc.get('rec_financeiras')  ?? new Decimal(0);
    const ebit    = lucroLiq.add(irCsll).add(despFin).minus(recFin);
    acc.set('ebit',   ebit);
    acc.set('ebitda', deprec.greaterThan(0) ? ebit.add(deprec) : ebit);
    if (!deprec.greaterThan(0)) alertas.push('Depreciação não encontrada — EBITDA = EBIT');
  }

  // ─── Validações A3 / B / C ───────────────────────────────────────────────────

  // A3: verifica que soma das folhas de cada galho sintético fecha com o valor declarado.
  // Apenas registra alertas (não aborta) — ECF pode omitir sub-itens zerados.
  private verificarHierarquia(
    registros: { linhaCodigo: string; valor: Decimal }[],
    isFolha:   (cod: string) => boolean,
    alertas:   string[],
  ): void {
    const sinteticos = registros.filter(r => !isFolha(r.linhaCodigo) && r.linhaCodigo.startsWith('3.01'));
    for (const s of sinteticos) {
      const folhas = registros.filter(
        r => isFolha(r.linhaCodigo) && r.linhaCodigo.startsWith(s.linhaCodigo + '.'),
      );
      if (folhas.length === 0) continue;
      const somaFolhas = folhas.reduce((acc, r) => acc.add(abs(r.valor)), new Decimal(0));
      const esperado   = abs(s.valor);
      if (esperado.isZero()) continue;
      const dif = somaFolhas.minus(esperado).abs();
      const tol = Decimal.max(new Decimal(1), esperado.mul('0.001')); // ±0.1% ou R$1
      if (dif.greaterThan(tol)) {
        const excesso = somaFolhas.greaterThan(esperado);
        alertas.push(
          `[VALID-A3] galho ${s.linhaCodigo}: folhas=${somaFolhas.toFixed(0)} ECF=${esperado.toFixed(0)} ` +
          `dif=${dif.toFixed(0)} — ${excesso ? 'dupla contagem provável' : 'omissão tolerável'}`,
        );
      }
    }
  }

  // B: reconciliação contábil — EBITDA = LL + IR/CSLL + DespFin − RecFin + D&A
  // Falha forte: mapeamento incompleto → não publicar.
  private verificarReconciliacao(acc: Map<LinhaDre, Decimal>, alertas: string[]): boolean {
    const ebitda = acc.get('ebitda');
    const ll     = acc.get('lucro_liquido');
    if (!ebitda || !ll || ebitda.isZero()) return true; // sem dados suficientes

    const ir      = acc.get('ir_csll')          ?? new Decimal(0);
    const despFin = acc.get('desp_financeiras') ?? new Decimal(0);
    const recFin  = acc.get('rec_financeiras')  ?? new Decimal(0);
    const deprec  = acc.get('depreciacao')      ?? new Decimal(0);

    const ebitdaReconciliado = ll.add(ir).add(despFin).minus(recFin).add(deprec);
    const dif = ebitdaReconciliado.minus(ebitda).abs();
    const tol = Decimal.max(new Decimal(1), ebitda.abs().mul('0.005')); // ±0.5% ou R$1

    if (dif.greaterThan(tol)) {
      alertas.push(
        `[VALID-B] reconciliação falhou: LL=${ll.toFixed(0)} IR=${ir.toFixed(0)} ` +
        `DespFin=${despFin.toFixed(0)} RecFin=${recFin.toFixed(0)} D&A=${deprec.toFixed(0)} ` +
        `→ ${ebitdaReconciliado.toFixed(0)} vs EBITDA=${ebitda.toFixed(0)} dif=${dif.toFixed(0)}`,
      );
      return false;
    }
    return true;
  }

  // C: invariantes de sanidade — garantem que os indicadores calculados fazem sentido.
  private verificarInvariantes(
    acc:            Map<LinhaDre, Decimal>,
    naoClassTotal:  Decimal,
    alertas:        string[],
  ): boolean {
    const rl     = acc.get('receita_liquida');
    const ebit   = acc.get('ebit')   ?? new Decimal(0);
    const ebitda = acc.get('ebitda') ?? new Decimal(0);
    let ok = true;

    if (rl?.greaterThan(0)) {
      const margem = ebitda.dividedBy(rl);
      if (margem.greaterThanOrEqualTo('0.99')) {
        alertas.push(`[VALID-C] margemEbitda=${(margem.toNumber() * 100).toFixed(1)}% ≥ 99% — mapeamento incompleto`);
        ok = false;
      }
      const naoClassRatio = naoClassTotal.dividedBy(rl);
      if (naoClassRatio.greaterThan('0.02')) {
        alertas.push(`[VALID-C] nao_class/RL=${(naoClassRatio.toNumber() * 100).toFixed(1)}% > 2%`);
        ok = false;
      }
    }
    if (ebitda.lessThan(ebit)) {
      alertas.push(`[VALID-C] ebitda=${ebitda.toFixed(0)} < ebit=${ebit.toFixed(0)} (D&A negativa?)`);
      // warning apenas — não bloqueia
    }
    return ok;
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

  private classificarSaldoEcd(grupo: string | null, desc: string): LinhaDre | null {
    if (!grupo) return null;
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
    return { linhas, completo: acc.has('receita_liquida'), fonteUsada: 'ecd_inferido', alertas, validacaoOk: true };
  }
}
