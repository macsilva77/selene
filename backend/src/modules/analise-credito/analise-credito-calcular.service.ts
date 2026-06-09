import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService }      from '../../database/prisma.service';
import { P02DreService }      from './p02/p02-dre.service';
import { P04Service }         from './p04/p04.service';
import { EcfDataSourceService } from './infrastructure/ecf-data-source.service';
import {
  calcularIndicadores,
  calcularEstruturaCapital,
  type BalData,
  type DreData,
} from './p03/p03-formulas';

export interface CalcularResultado {
  exercicio:   number;
  indicadores: number;
  comDados:    boolean;
}

@Injectable()
export class AnaliseCreditoCalcularService {
  private readonly logger = new Logger(AnaliseCreditoCalcularService.name);

  constructor(
    private readonly dreService:    P02DreService,
    private readonly ecfDataSource: EcfDataSourceService,
    private readonly p04Service:    P04Service,
    private readonly prisma:        PrismaService,
  ) {}

  // ─── ECF → BalData ──────────────────────────────────────────────────────────

  registrosPorRegime(regime: string | null, tipo: 'bp' | 'dre'): string[] {
    const MAPA: Record<string, { bp: string; dre: string }> = {
      lucro_real:       { bp: 'L100', dre: 'L300' },
      lucro_presumido:  { bp: 'P100', dre: 'P150' },
      lucro_arbitrado:  { bp: 'P100', dre: 'P150' },
      imune_isenta:     { bp: 'U100', dre: 'U150' },
      simples_nacional: { bp: 'P100', dre: 'P150' },
    };
    const cfg      = MAPA[regime ?? ''] ?? MAPA['lucro_real'];
    const primario = cfg[tipo];
    const todos    = tipo === 'bp' ? ['L100', 'P100', 'U100'] : ['L300', 'P150', 'U150'];
    return [primario, ...todos.filter(r => r !== primario)];
  }

  async ecfBalData(empresaId: string, exercicio: number, regime: string | null): Promise<BalData | null> {
    const candidatos = this.registrosPorRegime(regime, 'bp');
    for (const registroEcf of candidatos) {
      try {
        const resultado = await this.ecfDataSource.consultarComTrimestres(
          empresaId, exercicio, registroEcf,
        );
        if (!resultado || resultado.registros.length === 0) continue;

        const rows = resultado.registros;

        const codigosComFilhos = new Set(
          rows.map(r => r.linhaCodigo.split('.').slice(0, -1).join('.')).filter(Boolean),
        );

        const leafSum = (prefix: string): Decimal =>
          rows
            .filter(r => r.linhaCodigo.startsWith(`${prefix}.`) && !codigosComFilhos.has(r.linhaCodigo))
            .reduce((s, r) => s.add(new Decimal(r.valor)), new Decimal(0));

        const getAbs = (prefix: string): Decimal => {
          const exact = rows.find(r => r.linhaCodigo === prefix);
          if (exact) {
            const v = new Decimal(exact.valor).abs();
            if (v.greaterThan(0)) return v;
          }
          return leafSum(prefix).abs();
        };

        const getPLSigned = (): Decimal => {
          const exact = rows.find(r => r.linhaCodigo === '2.03');
          if (exact && !new Decimal(exact.valor).isZero()) {
            return new Decimal(exact.valor).negated();
          }
          return leafSum('2.03').negated();
        };

        const acTot  = getAbs('1.01');
        const ancTot = getAbs('1.02');
        const pcTot  = getAbs('2.01');
        const pncTot = getAbs('2.02');
        const plVal  = getPLSigned();
        if (acTot.isZero() && plVal.isZero()) continue;

        const caixa    = getAbs('1.01.01');
        const clientes = getAbs('1.01.02');
        const estoques = getAbs('1.01.03');
        const acOutros = Decimal.max(0, acTot.minus(caixa).minus(clientes).minus(estoques));

        const rlp       = getAbs('1.02.01');
        const ancOutros = Decimal.max(0, ancTot.minus(rlp));

        const fornec   = getAbs('2.01.01.01');
        const empCP    = Decimal.min(getAbs('2.01.01.04').add(getAbs('2.01.02')), pcTot);
        const pcOutros = Decimal.max(0, pcTot.minus(fornec).minus(empCP));

        const empLP     = Decimal.min(getAbs('2.02.01').add(getAbs('2.02.02')), pncTot);
        const pncOutros = Decimal.max(0, pncTot.minus(empLP));

        const bal: BalData = new Map();
        const set = (g: string, s: string, v: Decimal, allowNegative = false) => {
          if (allowNegative ? v.isZero() : !v.greaterThan(0)) return;
          if (!bal.has(g)) bal.set(g, new Map());
          bal.get(g)!.set(s, (bal.get(g)!.get(s) ?? new Decimal(0)).add(v));
        };

        set('AC',  'Caixa e Equivalentes', caixa);
        set('AC',  'Contas a Receber',     clientes);
        set('AC',  'Estoques',             estoques);
        set('AC',  'Outros',               acOutros);
        set('ANC', 'RLP',                  rlp);
        set('ANC', 'Outros',               ancOutros);
        set('PC',  'Fornecedores',         fornec);
        set('PC',  'Empréstimos CP',       empCP);
        set('PC',  'Outros',               pcOutros);
        set('PNC', 'Empréstimos LP',       empLP);
        set('PNC', 'Outros',               pncOutros);
        set('PL',  'Total',                plVal, true);

        return bal;
      } catch { continue; }
    }
    return null;
  }

  async ecfDreData(empresaId: string, exercicio: number, regime: string | null): Promise<DreData | null> {
    const candidatos = this.registrosPorRegime(regime, 'dre');
    for (const registroEcf of candidatos) {
      try {
        const resultado = await this.ecfDataSource.consultarComTrimestres(
          empresaId, exercicio, registroEcf,
        );
        if (!resultado || resultado.registros.length === 0) continue;

        const trimestre = resultado.trimestreAtivo;
        const res = await this.dreService.montar(empresaId, exercicio, regime, trimestre);
        if (res.linhas.length === 0) continue;

        const dre: DreData = new Map();
        for (const row of res.linhas) dre.set(row.linhaDre, row.valor);
        return dre;
      } catch { continue; }
    }
    return null;
  }

  // ─── Pipeline P02→P03→P04 para uma empresa ──────────────────────────────────

  async calcularParaEmpresa(empresa: {
    id:               string;
    cnpj:             string;
    regimeTributario: string | null;
  }): Promise<CalcularResultado[]> {
    const [arqRows, regRows] = await Promise.all([
      this.prisma.creditoEcfArquivo.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
      this.prisma.creditoEcfRegistro.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
    ]);
    const anos = [...new Set([...arqRows, ...regRows].map(r => r.exercicio))].sort((a, b) => a - b);
    const resultados: CalcularResultado[] = [];

    for (const ano of anos) {
      const [bal, dre] = await Promise.all([
        this.ecfBalData(empresa.id, ano, empresa.regimeTributario),
        this.ecfDreData(empresa.id, ano, empresa.regimeTributario),
      ]);

      if (!bal || !dre) {
        resultados.push({ exercicio: ano, indicadores: 0, comDados: false });
        continue;
      }

      const [balAnt, dreAnt] = await Promise.all([
        this.ecfBalData(empresa.id, ano - 1, empresa.regimeTributario),
        this.ecfDreData(empresa.id, ano - 1, empresa.regimeTributario),
      ]);

      const indicadores = calcularIndicadores(bal, dre, balAnt ?? undefined, dreAnt ?? undefined, 1);
      const estrutura   = calcularEstruturaCapital(bal, dre);
      const dreResult   = await this.dreService.montar(empresa.id, ano, empresa.regimeTributario);

      await this.prisma.$transaction(async tx => {
        await tx.creditoIndicador.deleteMany({ where: { empresaId: empresa.id, exercicio: ano } });
        if (indicadores.length > 0) {
          await tx.creditoIndicador.createMany({
            data: indicadores.map(i => ({
              empresaId: empresa.id,
              exercicio: ano,
              indicador: i.indicador,
              valor:     i.valor,
              unidade:   i.unidade,
              fonteOk:   i.fonteOk,
            })),
          });
        }

        await tx.creditoEstruturaCapital.upsert({
          where:  { empresaId_exercicio: { empresaId: empresa.id, exercicio: ano } },
          create: { empresaId: empresa.id, exercicio: ano, ...estrutura },
          update: estrutura,
        });

        await tx.creditoDre.deleteMany({ where: { empresaId: empresa.id, exercicio: ano } });
        if (dreResult.linhas.length > 0) {
          await tx.creditoDre.createMany({
            data: dreResult.linhas.map(l => ({
              empresaId: empresa.id,
              exercicio: ano,
              linhaDre:  l.linhaDre,
              valor:     l.valor,
              fonte:     l.fonte,
            })),
          });
        }
      }, { timeout: 30_000 });

      resultados.push({ exercicio: ano, indicadores: indicadores.length, comDados: true });
    }

    // P04 — alertas e classificação
    for (const { exercicio, comDados } of resultados) {
      if (!comDados) continue;
      try {
        await this.p04Service.processarExercicio(empresa.id, exercicio);
      } catch (err) {
        this.logger.warn(`[Calcular] ${empresa.cnpj} P04 exercicio=${exercicio}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`[Calcular] ${empresa.cnpj} — ${resultados.filter(r => r.comDados).length} exercícios processados`);
    return resultados;
  }
}
