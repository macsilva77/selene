/**
 * P02 — Serviço de Balanço Patrimonial
 * Fonte primária: ECF (L100/P100/U100, regime-aware).
 * Fallback: ECD J100 saldos analíticos.
 * Valida equação Ativo = Passivo + PL (tolerância R$ 1,00).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { EcfDataSourceService } from '../infrastructure/ecf-data-source.service';
import { Decimal } from '@prisma/client/runtime/library';

export interface BalancoRow {
  contaCodigo: string;
  contaNome:   string;
  grupo:       string;
  subgrupo:    string;
  valor:       Decimal;
  fonte:       string;
}

export interface BalancoResult {
  linhas:         BalancoRow[];
  totalAtivo:     Decimal;
  totalPassivoPl: Decimal;
  divergencia:    Decimal;
  bloqueado:      boolean;
  mensagem?:      string;
}

// ─── Classificação por subgrupo ───────────────────────────────────────────────

// Prefixos do Plano Referencial RFB (ECF L100/P100/U100) — fonte primária
const ECF_PREFIX_SUBGRUPO: Array<{ prefixo: string; subgrupo: string }> = [
  { prefixo: '1.01.01', subgrupo: 'Caixa e Equivalentes' },   // DISPONIBILIDADES
  { prefixo: '1.01.02', subgrupo: 'Contas a Receber' },        // CRÉDITOS
  { prefixo: '1.01.03', subgrupo: 'Estoques' },                // ESTOQUES
  { prefixo: '1.02.01', subgrupo: 'RLP' },                     // REALIZÁVEL A LONGO PRAZO
  { prefixo: '1.02.02', subgrupo: 'Outros ANC' },              // INVESTIMENTOS
  { prefixo: '1.02.03', subgrupo: 'Imobilizado' },             // IMOBILIZADO
  { prefixo: '1.02.04', subgrupo: 'Intangível' },              // INTANGÍVEL
  { prefixo: '2.01.01.01', subgrupo: 'Fornecedores' },
  { prefixo: '2.01.01.02', subgrupo: 'Salários e Encargos' },  // PESSOAL
  { prefixo: '2.01.01.03', subgrupo: 'Tributos a Pagar' },     // OBRIGAÇÕES TRIBUTÁRIAS
  { prefixo: '2.01.01.04', subgrupo: 'Empréstimos CP' },       // EMPRÉSTIMOS E FINANCIAMENTOS
  { prefixo: '2.01.02',    subgrupo: 'Empréstimos CP' },       // variante de empréstimos CP
  { prefixo: '2.02.01',    subgrupo: 'Empréstimos LP' },       // OBRIGAÇÕES A LONGO PRAZO
  { prefixo: '2.02.02',    subgrupo: 'Empréstimos LP' },       // variante LP
  { prefixo: '2.03.01',    subgrupo: 'Capital Social' },
  { prefixo: '2.03.02',    subgrupo: 'Reservas' },
  { prefixo: '2.03.03',    subgrupo: 'Reservas' },
  { prefixo: '2.03.04',    subgrupo: 'Reservas' },
  { prefixo: '2.03.05',    subgrupo: 'Lucros Acumulados' },
  { prefixo: '2.03.06',    subgrupo: 'Resultado do Exercício' },
];

// Keywords para ECD (fonte de dados analíticos com nomes de conta reais)
const SUBGRUPO: Record<string, { grupos: string[]; palavras: string[] }> = {
  'Caixa e Equivalentes':   { grupos: ['AC'],       palavras: ['caixa','banco','aplicac','numerario','deposito','disponibilidade'] },
  'Contas a Receber':       { grupos: ['AC'],       palavras: ['cliente','duplicata','recebi','conta a receber','nota promissoria','credito'] },
  'Estoques':               { grupos: ['AC'],       palavras: ['estoque','mercadoria','produto','materia','insumo'] },
  'RLP':                    { grupos: ['ANC'],      palavras: ['realizavel longo','recebivel longo','cliente longo','duplicata longo','rlp','credito longo','tributo recuperar longo'] },
  'Imobilizado':            { grupos: ['AC','ANC'], palavras: ['imobilizado','maquina','veiculo','imovel','equipamento','movel','utensilio','instalacao'] },
  'Intangível':             { grupos: ['ANC'],      palavras: ['intangivel','goodwill','software','licenca','marca','patente'] },
  'Fornecedores':           { grupos: ['PC'],       palavras: ['fornecedor','conta pagar','duplicata a pagar','nota fiscal pagar'] },
  'Empréstimos CP':         { grupos: ['PC'],       palavras: ['emprestimo','financiamento','debenture','mutuo','cce','ccb','obrigacao'] },
  'Tributos a Pagar':       { grupos: ['PC'],       palavras: ['ir a recolher','csll','pis a recolher','cofins','iss','icms a recolher','tributo','simples','inss a recolher','irrf'] },
  'Salários e Encargos':    { grupos: ['PC'],       palavras: ['salario','ordenado','ferias','decimo','fgts','inss s/','previdencia','encargo social','pessoal'] },
  'Empréstimos LP':         { grupos: ['PNC'],      palavras: ['emprestimo','financiamento','longo prazo','debenture','mutuo','obrigacao longo'] },
  'Capital Social':         { grupos: ['PL'],       palavras: ['capital social','capital subscrito'] },
  'Reservas':               { grupos: ['PL'],       palavras: ['reserva'] },
  'Lucros Acumulados':      { grupos: ['PL'],       palavras: ['lucro acumulado','prejuizo acumulado','resultado acumulado','resultado retido'] },
  'Resultado do Exercício': { grupos: ['PL'],       palavras: ['resultado do exercicio','resultado do periodo','lucro do exercicio'] },
};

/** Classificação por prefixo de código ECF (Plano Referencial RFB) */
function classificarSubgrupoEcf(codigo: string, grupo: string, nome: string): string {
  for (const { prefixo, subgrupo } of ECF_PREFIX_SUBGRUPO) {
    if (codigo.startsWith(prefixo)) return subgrupo;
  }
  // Fallback: keyword matching (mesma lógica do ECD)
  return classificarSubgrupo(grupo, nome);
}

/** Classificação por palavras-chave na descrição (ECD) */
function classificarSubgrupo(grupo: string, nome: string): string {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [sub, { grupos, palavras }] of Object.entries(SUBGRUPO)) {
    if (!grupos.includes(grupo)) continue;
    for (const p of palavras) if (n.includes(p)) return sub;
  }
  return `Outros ${grupo}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class P02BalancoService {
  constructor(
    private readonly prisma:        PrismaService,
    private readonly ecfDataSource: EcfDataSourceService,
  ) {}

  /**
   * Monta o BP com prioridade: ECF (regime-aware: L100/P100/U100) → ECD J100.
   */
  async montar(
    empresaId: string,
    exercicio: number,
    regimeTributario?: string | null,
  ): Promise<BalancoResult> {
    const ecfResult = await this.montarDeEcf(empresaId, exercicio, regimeTributario);
    if (ecfResult) return ecfResult;
    return this.montarDeEcd(empresaId, exercicio);
  }

  // ─── Fonte ECF (L100 / P100 / U100) ─────────────────────────────────────────

  private candidatosBp(regime: string | null | undefined): string[] {
    const MAPA: Record<string, string[]> = {
      lucro_real:       ['L100', 'P100', 'U100'],
      lucro_presumido:  ['P100', 'L100', 'U100'],
      lucro_arbitrado:  ['P100', 'L100', 'U100'],
      imune_isenta:     ['U100', 'L100', 'P100'],
      simples_nacional: ['P100', 'L100', 'U100'],
    };
    return MAPA[regime ?? ''] ?? ['L100', 'P100', 'U100'];
  }

  /**
   * Mapeia o código do Plano Referencial ECF para o grupo contábil.
   * L100/P100/U100 seguem a numeração RFB:
   *   1.01.* → AC   1.02.* → ANC   2.01.* → PC   2.02.* → PNC   2.03.* → PL
   * Fallback por descrição cobre variações de regime.
   */
  private detectarGrupo(codigo: string, descricao: string): string | null {
    if (codigo.startsWith('1.01')) return 'AC';
    if (codigo.startsWith('1.02') || codigo.startsWith('1.0')) return 'ANC';
    if (codigo.startsWith('1.'))   return 'ANC';
    if (codigo.startsWith('2.01')) return 'PC';
    if (codigo.startsWith('2.02')) return 'PNC';
    if (codigo.startsWith('2.03') || codigo.startsWith('2.04') || codigo.startsWith('2.1')) return 'PL';
    if (codigo.startsWith('3.') || codigo.startsWith('4.')) return null; // DRE — pular

    // Fallback por descrição (P100/U100 podem usar códigos distintos)
    const d = descricao.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (d.includes('ativo circulante'))                                           return 'AC';
    if (d.includes('ativo nao circulante') || d.includes('ativo permanente'))     return 'ANC';
    if (d.includes('passivo circulante'))                                          return 'PC';
    if (d.includes('passivo nao circulante') || d.includes('exigivel longo'))     return 'PNC';
    if (d.includes('patrimonio liquido') || d.includes('capital social'))         return 'PL';

    return null;
  }

  private async montarDeEcf(
    empresaId: string,
    exercicio: number,
    regimeTributario?: string | null,
  ): Promise<BalancoResult | null> {
    const candidatos = this.candidatosBp(regimeTributario);

    for (const registroEcf of candidatos) {
      // Usa Q4 (trimestre=4) quando disponível — posição 31/dez; fallback trimestre=0 (anual)
      // EcfDataSource roteia: Parquet (novo) → banco relacional (fallback legado)
      const trims = await this.ecfDataSource.trimestresDisponiveis(empresaId, exercicio, registroEcf);
      if (trims.length === 0) continue;
      const trimestre = trims.includes(4) ? 4 : Math.max(...trims);

      const rows = await this.ecfDataSource.consultar(empresaId, exercicio, { registroEcf, trimestre });
      if (rows.length === 0) continue;

      // Identifica nós-folha (sem filhos): apenas eles entram no balanço
      const codigosComFilhos = new Set<string>();
      for (const { linhaCodigo } of rows) {
        const parts = linhaCodigo.split('.');
        for (let i = 1; i < parts.length; i++) {
          codigosComFilhos.add(parts.slice(0, i).join('.'));
        }
      }

      const linhas: BalancoRow[] = [];
      for (const r of rows) {
        if (codigosComFilhos.has(r.linhaCodigo)) continue; // nó sintético — pular
        const grupo = this.detectarGrupo(r.linhaCodigo, r.descricao);
        if (!grupo) continue;
        const vAbs = new Decimal(r.valor).abs();
        if (vAbs.isZero()) continue;
        linhas.push({
          contaCodigo: r.linhaCodigo,
          contaNome:   r.descricao,
          grupo,
          subgrupo:    classificarSubgrupoEcf(r.linhaCodigo, grupo, r.descricao),
          valor:       vAbs,
          fonte:       `ecf_${registroEcf.toLowerCase()}`,
        });
      }

      if (linhas.length === 0) continue;

      const somarGrupos = (gs: string[]) =>
        linhas.filter(l => gs.includes(l.grupo)).reduce((s, l) => s.add(l.valor), new Decimal(0));

      const totalAtivo     = somarGrupos(['AC', 'ANC']);
      const totalPassivoPl = somarGrupos(['PC', 'PNC', 'PL']);
      const divergencia    = totalAtivo.minus(totalPassivoPl).abs();
      const bloqueado      = divergencia.greaterThan(1);

      return {
        linhas,
        totalAtivo,
        totalPassivoPl,
        divergencia,
        bloqueado,
        mensagem: bloqueado
          ? `Balanço ECF (${registroEcf}) não fecha: divergência R$ ${divergencia.toFixed(2)}`
          : undefined,
      };
    }

    return null; // sem dados ECF — usar ECD
  }

  // ─── Fallback ECD (J100 saldos analíticos) ───────────────────────────────────

  private async montarDeEcd(empresaId: string, exercicio: number): Promise<BalancoResult> {
    const periodoMax = await this.prisma.creditoEcdSaldo.findFirst({
      where:   { empresaId, exercicio },
      orderBy: { periodo: 'desc' },
      select:  { periodo: true },
    });

    if (!periodoMax) {
      return {
        linhas: [], totalAtivo: new Decimal(0), totalPassivoPl: new Decimal(0),
        divergencia: new Decimal(0), bloqueado: true,
        mensagem: 'Sem saldos ECD para este exercício',
      };
    }

    const saldos = await this.prisma.creditoEcdSaldo.findMany({
      where: { empresaId, exercicio, periodo: periodoMax.periodo, NOT: { saldoFinal: 0 } },
    });

    const plano = await this.prisma.creditoPlanoConta.findMany({
      where:  { empresaId, exercicio },
      select: { contaCodigo: true, tipo: true, grupo: true },
    });
    const planoMap = new Map(plano.map(p => [p.contaCodigo, p]));

    const linhas: BalancoRow[] = [];
    for (const s of saldos) {
      const meta = planoMap.get(s.contaCodigo);
      if (meta?.tipo === 'sintetica') continue;
      const grupo    = meta?.grupo ?? s.grupo ?? 'AC';
      const subgrupo = classificarSubgrupo(grupo, s.contaNome);
      linhas.push({
        contaCodigo: s.contaCodigo, contaNome: s.contaNome,
        grupo, subgrupo, valor: s.saldoFinal.abs(), fonte: 'ecd_j100',
      });
    }

    const somarGrupos = (gs: string[]) =>
      linhas.filter(l => gs.includes(l.grupo)).reduce((s, l) => s.add(l.valor), new Decimal(0));

    const totalAtivo     = somarGrupos(['AC', 'ANC']);
    const totalPassivoPl = somarGrupos(['PC', 'PNC', 'PL']);
    const divergencia    = totalAtivo.minus(totalPassivoPl).abs();
    const bloqueado      = divergencia.greaterThan(1);

    if (!bloqueado && divergencia.greaterThan(0)) {
      linhas.push({
        contaCodigo: 'AJUSTE_ARR', contaNome: 'Ajuste de arredondamento',
        grupo: 'AC', subgrupo: 'Outros AC', valor: divergencia, fonte: 'inferido',
      });
    }

    return {
      linhas, totalAtivo, totalPassivoPl, divergencia, bloqueado,
      mensagem: bloqueado
        ? `Balanço ECD não fecha: divergência R$ ${divergencia.toFixed(2)}`
        : undefined,
    };
  }
}
