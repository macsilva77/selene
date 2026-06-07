import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }       from '../../../database/prisma.service';
import { Decimal }             from '@prisma/client/runtime/library';
import { avaliarRegras, classificar, RegraCtx } from './p04-regras';

import { VERSAO_P04 } from '../shared/versoes';

const VERSAO_PROMPT = VERSAO_P04;

export interface P04Resultado {
  empresaId: string;
  exercicio: number;
  status:    'ok' | 'bloqueado' | 'pulado' | 'erro';
  mensagem?: string;
}

@Injectable()
export class P04Service {
  private readonly logger = new Logger(P04Service.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── API pública ───────────────────────────────────────────────────────────

  async processarTodos(tenantId: string): Promise<P04Resultado[]> {
    const empresas = await this.prisma.creditoEmpresa.findMany({
      where: { tenantId }, select: { id: true },
    });
    const resultados: P04Resultado[] = [];
    for (const e of empresas) {
      const exercicios = await this.descobrirExercicios(e.id);
      for (const exercicio of exercicios) {
        try {
          resultados.push(await this.processarExercicio(e.id, exercicio));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`[P04] empresa=${e.id} exercicio=${exercicio}: ${msg}`, err instanceof Error ? err.stack : undefined);
          resultados.push({ empresaId: e.id, exercicio, status: 'erro', mensagem: msg });
        }
      }
    }
    return resultados;
  }

  async processarExercicio(empresaId: string, exercicio: number): Promise<P04Resultado> {
    const t0 = Date.now();
    this.logger.log(`[P04] empresa=${empresaId} exercicio=${exercicio}`);

    if (await this.jaProcessado(empresaId, exercicio)) {
      this.logger.log(`[P04] empresa=${empresaId}/${exercicio} — pulando`);
      return { empresaId, exercicio, status: 'pulado' };
    }

    // Carrega indicadores de todos os exercícios do CNPJ (série histórica)
    const todosInds = await this.prisma.creditoIndicador.findMany({
      where:   { empresaId },
      orderBy: { exercicio: 'asc' },
    });

    // Índice: exercicio → nome → {valor, fonteOk}
    type IndEntry = { valor: Decimal | null; fonteOk: number };
    const indPorAno = new Map<number, Map<string, IndEntry>>();
    for (const r of todosInds) {
      if (!indPorAno.has(r.exercicio)) indPorAno.set(r.exercicio, new Map());
      indPorAno.get(r.exercicio)!.set(r.indicador, { valor: r.valor, fonteOk: r.fonteOk });
    }

    const exerciciosOrdenados = [...indPorAno.keys()].sort((a, b) => a - b);
    const idxAtual = exerciciosOrdenados.indexOf(exercicio);
    const exercicioAnt = idxAtual > 0 ? exerciciosOrdenados[idxAtual - 1] : null;

    const indAtual = indPorAno.get(exercicio) ?? new Map<string, IndEntry>();
    const indAnt   = exercicioAnt ? (indPorAno.get(exercicioAnt) ?? new Map<string, IndEntry>()) : null;

    // Monta o contexto para as regras
    const ctx: RegraCtx = {
      ind:  nome => indAtual.get(nome)?.valor ?? null,
      indAnt: nome => indAnt?.get(nome)?.valor ?? null,
      serie: nome => exerciciosOrdenados.map(a => indPorAno.get(a)?.get(nome)?.valor ?? null),
      fonte: nome => indAtual.get(nome)?.fonteOk ?? 1,
    };

    // Avalia as 25 regras
    const alertas = avaliarRegras(ctx);

    // Calcula confiabilidade
    const totalInds = indAtual.size;
    const inferidos = [...indAtual.values()].filter(v => v.fonteOk === 0).length;
    const percInferido = totalInds > 0 ? inferidos / totalInds : 0;

    // Classifica
    const { classificacao, confiabilidade } = classificar(alertas, percInferido);

    // ── Persiste tb_alertas ────────────────────────────────────────────────
    await this.prisma.$transaction(async tx => {
      await tx.creditoAlerta.deleteMany({ where: { empresaId, exercicio } });
      if (alertas.length > 0) {
        await tx.creditoAlerta.createMany({
          data: alertas.map(a => ({ empresaId, exercicio, ...a })),
        });
      }
    }, { timeout: 30000 });

    // ── Persiste tb_classificacoes ─────────────────────────────────────────
    const qtdCriticos  = alertas.filter(a => a.severidade === 'critico').length;
    const qtdAtencao   = alertas.filter(a => a.severidade === 'atencao').length;
    const qtdPositivos = alertas.filter(a => a.severidade === 'positivo').length;

    await this.prisma.creditoClassificacao.upsert({
      where:  { empresaId_exercicio: { empresaId, exercicio } },
      create: {
        empresaId, exercicio,
        classificacao:     classificacao.classificacao,
        classificacaoNum:  classificacao.classificacaoNum,
        qtdCriticos, qtdAtencao, qtdPositivos,
        overrideAplicado:  classificacao.overrideAplicado,
        motivoOverride:    classificacao.motivoOverride,
        confiabilidade,
      },
      update: {
        classificacao:    classificacao.classificacao,
        classificacaoNum: classificacao.classificacaoNum,
        qtdCriticos, qtdAtencao, qtdPositivos,
        overrideAplicado: classificacao.overrideAplicado,
        motivoOverride:   classificacao.motivoOverride,
        confiabilidade,
      },
    });

    const ms = Date.now() - t0;
    await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_alertas',
      total: alertas.length, ok: alertas.length, alerta: 0, bloqueados: 0, hash: null, duracaoMs: ms });
    await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_classificacoes',
      total: 1, ok: 1, alerta: 0, bloqueados: 0, hash: null, duracaoMs: ms });

    this.logger.log(
      `[P04] empresa=${empresaId}/${exercicio}: ${qtdCriticos} críticos ` +
      `${qtdAtencao} atenção ${qtdPositivos} positivos → ${classificacao.classificacao}`
    );
    return { empresaId, exercicio, status: 'ok' };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async descobrirExercicios(empresaId: string): Promise<number[]> {
    const rows = await this.prisma.creditoIndicador.findMany({
      where:    { empresaId },
      select:   { exercicio: true },
      distinct: ['exercicio'],
    });
    return rows.map(r => r.exercicio);
  }

  private async jaProcessado(empresaId: string, exercicio: number): Promise<boolean> {
    return !!await this.prisma.creditoProcessamento.findFirst({
      where: { empresaId, exercicio, versaoPrompt: VERSAO_PROMPT,
               registrosBloqueados: 0, tabelaDestino: 'tb_classificacoes' },
    });
  }

  private async gravarProcessamento(p: {
    empresaId: string; exercicio: number; tabela: string;
    total: number; ok: number; alerta: number; bloqueados: number;
    hash: string | null; duracaoMs: number;
  }) {
    const { empresaId, exercicio, tabela: tabelaDestino,
            total, ok, alerta, bloqueados, hash, duracaoMs } = p;
    await this.prisma.creditoProcessamento.upsert({
      where: { empresaId_exercicio_tabelaDestino_versaoPrompt:
        { empresaId, exercicio, tabelaDestino, versaoPrompt: VERSAO_PROMPT } },
      create: { empresaId, exercicio, tabelaDestino, totalRegistros: total,
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
