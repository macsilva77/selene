/**
 * P02 — Serviço de Balanço Patrimonial
 * Classifica contas analíticas do último período ECD no subgrupo correto
 * e valida a equação Ativo = Passivo + PL (tolerância R$ 1,00).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
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

// ─── Tabelas de palavras-chave por subgrupo ────────────────────────────────────

const SUBGRUPO: Record<string, { grupos: string[]; palavras: string[] }> = {
  'Caixa e Equivalentes':   { grupos: ['AC'],         palavras: ['caixa','banco','aplicac','numerario','deposito'] },
  'Contas a Receber':       { grupos: ['AC'],         palavras: ['cliente','duplicata','recebi','conta a receber','nota promissoria'] },
  'Estoques':               { grupos: ['AC'],         palavras: ['estoque','mercadoria','produto','materia','insumo'] },
  'RLP':                    { grupos: ['ANC'],        palavras: ['realizavel longo','recebivel longo','cliente longo','duplicata longo','rlp','credito longo','tributo recuperar longo'] },
  'Imobilizado':            { grupos: ['AC','ANC'],   palavras: ['imobilizado','maquina','veiculo','imovel','equipamento','movel','utensilio','instalacao'] },
  'Intangível':             { grupos: ['ANC'],        palavras: ['intangivel','goodwill','software','licenca','marca','patente'] },
  'Fornecedores':           { grupos: ['PC'],         palavras: ['fornecedor','conta pagar','duplicata a pagar','nota fiscal pagar'] },
  'Empréstimos CP':         { grupos: ['PC'],         palavras: ['emprestimo','financiamento','debenture','mutuo','cce','ccb'] },
  'Tributos a Pagar':       { grupos: ['PC'],         palavras: ['ir a recolher','csll','pis a recolher','cofins','iss','icms a recolher','tributo','simples','inss a recolher','irrf'] },
  'Salários e Encargos':    { grupos: ['PC'],         palavras: ['salario','ordenado','ferias','decimo','fgts','inss s/','previdencia','encargo social'] },
  'Empréstimos LP':         { grupos: ['PNC'],        palavras: ['emprestimo','financiamento','longo prazo','debenture','mutuo'] },
  'Capital Social':         { grupos: ['PL'],         palavras: ['capital social','capital subscrito'] },
  'Reservas':               { grupos: ['PL'],         palavras: ['reserva'] },
  'Lucros Acumulados':      { grupos: ['PL'],         palavras: ['lucro acumulado','prejuizo acumulado','resultado acumulado','resultado retido'] },
  'Resultado do Exercício': { grupos: ['PL'],         palavras: ['resultado do exercicio','resultado do periodo','lucro do exercicio'] },
};

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
  constructor(private readonly prisma: PrismaService) {}

  async montar(empresaId: string, exercicio: number): Promise<BalancoResult> {
    // Último período disponível para este exercício
    const periodoMax = await this.prisma.creditoEcdSaldo.findFirst({
      where:   { empresaId, exercicio },
      orderBy: { periodo: 'desc' },
      select:  { periodo: true },
    });

    if (!periodoMax) {
      return { linhas: [], totalAtivo: new Decimal(0), totalPassivoPl: new Decimal(0),
               divergencia: new Decimal(0), bloqueado: true,
               mensagem: 'Sem saldos ECD para este exercício' };
    }

    // Busca apenas contas analíticas com saldo != 0 no último período
    const saldos = await this.prisma.creditoEcdSaldo.findMany({
      where: {
        empresaId,
        exercicio,
        periodo: periodoMax.periodo,
        NOT: { saldoFinal: 0 },
      },
    });

    // Plano para saber tipo (sintetica/analitica)
    const plano = await this.prisma.creditoPlanoConta.findMany({
      where:  { empresaId, exercicio },
      select: { contaCodigo: true, tipo: true, grupo: true },
    });
    const planoMap = new Map(plano.map(p => [p.contaCodigo, p]));

    const linhas: BalancoRow[] = [];

    for (const s of saldos) {
      const meta = planoMap.get(s.contaCodigo);
      // Contas sintéticas servem apenas para agrupamento — não entram no balanço
      if (meta?.tipo === 'sintetica') continue;

      const grupo   = meta?.grupo ?? s.grupo ?? 'AC';
      const subgrupo = classificarSubgrupo(grupo, s.contaNome);

      // Converte para valor absoluto: D=Ativo (positivo), C=Passivo/PL (positivo)
      const vAbs = s.saldoFinal.abs();

      linhas.push({ contaCodigo: s.contaCodigo, contaNome: s.contaNome,
                    grupo, subgrupo, valor: vAbs, fonte: 'ecd_j100' });
    }

    // Totais
    const grupos = (g: string[]) =>
      linhas.filter(l => g.includes(l.grupo))
            .reduce((acc, l) => acc.add(l.valor), new Decimal(0));

    const totalAtivo     = grupos(['AC', 'ANC']);
    const totalPassivoPl = grupos(['PC', 'PNC', 'PL']);
    const divergencia    = totalAtivo.minus(totalPassivoPl).abs();
    const bloqueado      = divergencia.greaterThan(1);

    if (!bloqueado && divergencia.greaterThan(0)) {
      // Ajuste de arredondamento em Outros AC
      linhas.push({
        contaCodigo: 'AJUSTE_ARR', contaNome: 'Ajuste de arredondamento',
        grupo: 'AC', subgrupo: 'Outros AC',
        valor: divergencia, fonte: 'inferido',
      });
    }

    return {
      linhas,
      totalAtivo,
      totalPassivoPl,
      divergencia,
      bloqueado,
      mensagem: bloqueado
        ? `Balanço não fecha: divergência R$ ${divergencia.toFixed(2)}`
        : undefined,
    };
  }
}
