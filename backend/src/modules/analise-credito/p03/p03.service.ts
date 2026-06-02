import { Injectable, Logger }     from '@nestjs/common';
import { PrismaService }           from '../../../database/prisma.service';
import { Decimal }                 from '@prisma/client/runtime/library';
import {
  BalData, DreData,
  calcularIndicadores, calcularEstruturaCapital,
  getBal, getDre,
} from './p03-formulas';

const VERSAO_PROMPT = 'P03-v1';
const VERSAO_P02    = 'P02-v1';

export interface P03Resultado {
  empresaId: string;
  exercicio: number;
  status:    'ok' | 'bloqueado' | 'pulado' | 'erro';
  mensagem?: string;
}

@Injectable()
export class P03Service {
  private readonly logger = new Logger(P03Service.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── API pública ───────────────────────────────────────────────────────────

  async processarTodos(tenantId: string): Promise<P03Resultado[]> {
    const empresas = await this.prisma.creditoEmpresa.findMany({
      where:  { tenantId },
      select: { id: true },
    });
    const resultados: P03Resultado[] = [];
    for (const e of empresas) {
      const exercicios = await this.descobrirExercicios(e.id);
      for (const exercicio of exercicios) {
        try {
          resultados.push(await this.processarExercicio(e.id, exercicio));
        } catch (err) {
          this.logger.error(`[P03] empresa=${e.id} exercicio=${exercicio}: ${err}`);
          resultados.push({ empresaId: e.id, exercicio, status: 'erro', mensagem: String(err) });
        }
      }
    }
    return resultados;
  }

  async processarExercicio(empresaId: string, exercicio: number): Promise<P03Resultado> {
    const t0 = Date.now();
    this.logger.log(`[P03] empresa=${empresaId} exercicio=${exercicio}`);

    if (!await this.verificarP02(empresaId, exercicio)) {
      await this.gravarInc(empresaId, exercicio, 'P03_PREREQ_FALHOU',
        'P02 não concluído para este exercício', 'bloqueio');
      return { empresaId, exercicio, status: 'bloqueado', mensagem: 'P02 não concluído' };
    }

    if (await this.jaProcessado(empresaId, exercicio)) {
      this.logger.log(`[P03] empresa=${empresaId}/${exercicio} — pulando`);
      return { empresaId, exercicio, status: 'pulado' };
    }

    // Carrega dados P02
    const bal    = await this.carregarBal(empresaId, exercicio);
    const dre    = await this.carregarDre(empresaId, exercicio);
    const fonteOk = await this.avaliarFonteOk(empresaId, exercicio);

    // Dados do ano anterior (Grupo 6 — crescimento)
    const exercicioAnt = exercicio - 1;
    const balAnt = await this.carregarBal(empresaId, exercicioAnt).catch(() => undefined);
    const dreAnt = await this.carregarDre(empresaId, exercicioAnt).catch(() => undefined);

    // ── Calcula indicadores ────────────────────────────────────────────────
    const indicadores = calcularIndicadores(bal, dre, balAnt, dreAnt, fonteOk);

    // ── Persiste tb_indicadores ───────────────────────────────────────────
    for (const ind of indicadores) {
      await this.prisma.creditoIndicador.upsert({
        where: { empresaId_exercicio_indicador: { empresaId, exercicio, indicador: ind.indicador } },
        create: {
          empresaId, exercicio,
          indicador: ind.indicador,
          valor:     ind.valor,
          unidade:   ind.unidade,
          fonteOk:   ind.fonteOk,
        },
        update: { valor: ind.valor, unidade: ind.unidade, fonteOk: ind.fonteOk },
      });

      // NULL documentado em inconsistências
      if (ind.valor === null) {
        await this.gravarInc(empresaId, exercicio,
          'INDICADOR_NULL', `${ind.indicador}: SAFE_DIV retornou NULL`, 'info');
      }
    }

    // ── Persiste tb_estrutura_capital ─────────────────────────────────────
    const ec = calcularEstruturaCapital(bal, dre);
    await this.prisma.creditoEstruturaCapital.upsert({
      where:  { empresaId_exercicio: { empresaId, exercicio } },
      create: { empresaId, exercicio, ...ec },
      update: ec,
    });

    const ms = Date.now() - t0;
    await this.gravarProcessamento(empresaId, exercicio, 'tb_indicadores',
      indicadores.length, indicadores.filter(i => i.valor !== null).length,
      indicadores.filter(i => i.fonteOk === 0).length, 0, null, ms);
    await this.gravarProcessamento(empresaId, exercicio, 'tb_estrutura_capital',
      1, 1, 0, 0, null, ms);

    this.logger.log(`[P03] empresa=${empresaId}/${exercicio}: ${indicadores.length} indicadores em ${ms}ms`);
    return { empresaId, exercicio, status: 'ok' };
  }

  // ─── Carregamento de dados ─────────────────────────────────────────────────

  private async carregarBal(empresaId: string, exercicio: number): Promise<BalData> {
    const linhas = await this.prisma.creditoBalanco.findMany({
      where:  { empresaId, exercicio },
      select: { grupo: true, subgrupo: true, valor: true },
    });
    const bal: BalData = new Map();
    for (const l of linhas) {
      if (!bal.has(l.grupo)) bal.set(l.grupo, new Map());
      const grupoMap = bal.get(l.grupo)!;
      grupoMap.set(l.subgrupo, (grupoMap.get(l.subgrupo) ?? new Decimal(0)).add(l.valor));
    }
    return bal;
  }

  private async carregarDre(empresaId: string, exercicio: number): Promise<DreData> {
    const linhas = await this.prisma.creditoDre.findMany({
      where:  { empresaId, exercicio },
      select: { linhaDre: true, valor: true },
    });
    const dre: DreData = new Map();
    for (const l of linhas) dre.set(l.linhaDre, l.valor);
    return dre;
  }

  /** fonteOk=0 se qualquer linha do balanço ou DRE vier de fonte 'inferido' */
  private async avaliarFonteOk(empresaId: string, exercicio: number): Promise<number> {
    const inf = await this.prisma.creditoBalanco.count({
      where: { empresaId, exercicio, fonte: 'inferido' },
    });
    const infDre = await this.prisma.creditoDre.count({
      where: { empresaId, exercicio, fonte: 'ecd_inferido' },
    });
    return inf + infDre > 0 ? 0 : 1;
  }

  // ─── Helpers de controle ───────────────────────────────────────────────────

  private async descobrirExercicios(empresaId: string): Promise<number[]> {
    const rows = await this.prisma.creditoProcessamento.findMany({
      where: { empresaId, versaoPrompt: VERSAO_P02, registrosBloqueados: 0,
               tabelaDestino: { in: ['tb_balanco', 'tb_dre'] } },
      select: { exercicio: true }, distinct: ['exercicio'],
    });
    return rows.map(r => r.exercicio);
  }

  private async verificarP02(empresaId: string, exercicio: number): Promise<boolean> {
    return !!await this.prisma.creditoProcessamento.findFirst({
      where: { empresaId, exercicio, versaoPrompt: VERSAO_P02,
               registrosBloqueados: 0, tabelaDestino: { in: ['tb_balanco', 'tb_dre'] } },
    });
  }

  private async jaProcessado(empresaId: string, exercicio: number): Promise<boolean> {
    return !!await this.prisma.creditoProcessamento.findFirst({
      where: { empresaId, exercicio, versaoPrompt: VERSAO_PROMPT, registrosBloqueados: 0,
               tabelaDestino: 'tb_indicadores' },
    });
  }

  private async gravarProcessamento(
    empresaId: string, exercicio: number, tabela: string,
    total: number, ok: number, alerta: number, bloqueados: number,
    hash: string | null, duracaoMs: number,
  ) {
    await this.prisma.creditoProcessamento.upsert({
      where: { empresaId_exercicio_tabelaDestino_versaoPrompt:
        { empresaId, exercicio, tabelaDestino: tabela, versaoPrompt: VERSAO_PROMPT } },
      create: { empresaId, exercicio, tabelaDestino: tabela, totalRegistros: total,
        registrosOk: ok, registrosComAlerta: alerta, registrosBloqueados: bloqueados,
        hashArquivoOrigem: hash, timestampProcessamento: new Date(),
        versaoPrompt: VERSAO_PROMPT, duracaoMs },
      update: { totalRegistros: total, registrosOk: ok, registrosComAlerta: alerta,
        registrosBloqueados: bloqueados, timestampProcessamento: new Date(), duracaoMs },
    });
  }

  private async gravarInc(
    empresaId: string, exercicio: number,
    tipoErro: string, descricao: string, severidade: string,
  ) {
    await this.prisma.creditoInconsistencia.create({
      data: { empresaId, exercicio, tipoErro, descricao, severidade },
    });
  }
}
