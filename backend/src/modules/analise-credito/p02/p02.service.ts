import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../../database/prisma.service';
import { P02BalancoService }  from './p02-balanco.service';
import { P02DreService }      from './p02-dre.service';

const VERSAO_PROMPT  = 'P02-v4';
const VERSAO_P01     = 'P01-v3';

export interface P02Resultado {
  empresaId: string;
  exercicio: number;
  status:    'ok' | 'bloqueado' | 'pulado' | 'erro';
  mensagem?: string;
}

@Injectable()
export class P02Service {
  private readonly logger = new Logger(P02Service.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly balanco:  P02BalancoService,
    private readonly dre:      P02DreService,
  ) {}

  // ─── API pública ───────────────────────────────────────────────────────────

  async processarTodos(tenantId: string): Promise<P02Resultado[]> {
    const empresas = await this.prisma.creditoEmpresa.findMany({
      where: { tenantId },
      select: { id: true, cnpj: true },
    });

    const resultados: P02Resultado[] = [];
    for (const e of empresas) {
      const exercicios = await this.descobrirExercicios(e.id);
      for (const exercicio of exercicios) {
        try {
          const r = await this.processarExercicio(e.id, exercicio);
          resultados.push(r);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`[P02] Erro em empresa=${e.id} exercicio=${exercicio}: ${msg}`, err instanceof Error ? err.stack : undefined);
          // Grava bloqueio visível no dashboard mesmo quando a exceção é inesperada
          try {
            await this.gravarProcessamento({
              empresaId: e.id, exercicio, tabela: 'tb_balanco',
              total: 0, ok: 0, alerta: 0, bloqueados: 1,
              hash: msg.slice(0, 64), duracaoMs: 0,
            });
            await this.gravarInconsistencia(e.id, exercicio, 'P02_ERRO_INESPERADO', msg, 'bloqueio');
          } catch { /* falha secundária — ignora */ }
          resultados.push({ empresaId: e.id, exercicio, status: 'erro', mensagem: msg });
        }
      }
    }
    return resultados;
  }

  async processarExercicio(empresaId: string, exercicio: number): Promise<P02Resultado> {
    const t0 = Date.now();
    this.logger.log(`[P02] empresa=${empresaId} exercicio=${exercicio}`);

    // Pré-requisito: P01 concluído sem bloqueios
    const p01ok = await this.verificarP01(empresaId, exercicio);
    if (!p01ok) {
      this.logger.warn(`[P02] empresa=${empresaId} exercicio=${exercicio} — P01-v2 não encontrado`);
      await this.gravarProcessamento({
        empresaId, exercicio, tabela: 'tb_balanco',
        total: 0, ok: 0, alerta: 0, bloqueados: 1, hash: 'prereq_p01_falhou', duracaoMs: Date.now() - t0,
      });
      await this.gravarInconsistencia(empresaId, exercicio, 'P02_PREREQ_FALHOU',
        'P01-v2 não encontrado em tb_ecd_saldos ou tb_ecf_registros', 'bloqueio');
      return { empresaId, exercicio, status: 'bloqueado', mensagem: 'P01 não concluído' };
    }

    // Idempotência
    if (await this.jaProcessado(empresaId, exercicio)) {
      this.logger.log(`[P02] empresa=${empresaId} exercicio=${exercicio} — pulando`);
      return { empresaId, exercicio, status: 'pulado' };
    }

    // Regime tributário necessário para selecionar o registro ECF correto
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where:  { id: empresaId },
      select: { regimeTributario: true },
    });
    const regime = empresa?.regimeTributario ?? null;

    // ── Balanço ────────────────────────────────────────────────────────────────
    const balancoResult = await this.balanco.montar(empresaId, exercicio, regime);
    const msBalanco     = Date.now() - t0;

    if (balancoResult.bloqueado) {
      await this.gravarInconsistencia(empresaId, exercicio, 'BALANCO_NAO_FECHA',
        balancoResult.mensagem ?? 'Divergência > R$ 1,00', 'bloqueio');
      await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_balanco',
        total: 0, ok: 0, alerta: 0, bloqueados: 1, hash: null, duracaoMs: msBalanco });
      return { empresaId, exercicio, status: 'bloqueado', mensagem: balancoResult.mensagem };
    }

    // Grava linhas do balanço
    await this.prisma.$transaction(async tx => {
      await tx.creditoBalanco.deleteMany({ where: { empresaId, exercicio } });
      if (balancoResult.linhas.length > 0) {
        await tx.creditoBalanco.createMany({
          data: balancoResult.linhas.map(l => ({ empresaId, exercicio, ...l })),
          skipDuplicates: true,
        });
      }
    }, { timeout: 30000 });
    await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_balanco',
      total: balancoResult.linhas.length, ok: balancoResult.linhas.length, alerta: 0, bloqueados: 0,
      hash: null, duracaoMs: msBalanco });
    this.logger.log(`[P02] empresa=${empresaId}/${exercicio} balanço: ${balancoResult.linhas.length} linhas`);

    // ── DRE ────────────────────────────────────────────────────────────────────
    const dreResult = await this.dre.montar(empresaId, exercicio, regime);
    const msDre     = Date.now() - t0;

    await this.prisma.$transaction(async tx => {
      await tx.creditoDre.deleteMany({ where: { empresaId, exercicio } });
      if (dreResult.linhas.length > 0) {
        await tx.creditoDre.createMany({
          data: dreResult.linhas.map(l => ({ empresaId, exercicio, linhaDre: l.linhaDre, valor: l.valor, fonte: l.fonte })),
        });
      }
    }, { timeout: 30000 });

    // Alertas de fonte/completude
    for (const alerta of dreResult.alertas) {
      await this.gravarInconsistencia(empresaId, exercicio, 'DRE_ALERTA', alerta, 'alerta');
    }
    if (!dreResult.completo) {
      await this.gravarInconsistencia(empresaId, exercicio, 'DRE_INCOMPLETA',
        'Receita líquida ou lucro líquido não identificado', 'alerta');
    }

    const bloqueiosDre = dreResult.completo ? 0 : 1;
    await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_dre',
      total: dreResult.linhas.length, ok: dreResult.linhas.length,
      alerta: dreResult.alertas.length, bloqueados: bloqueiosDre,
      hash: dreResult.fonteUsada, duracaoMs: msDre });

    this.logger.log(`[P02] empresa=${empresaId}/${exercicio} DRE: ${dreResult.linhas.length} linhas (${dreResult.fonteUsada})`);
    return { empresaId, exercicio, status: 'ok' };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async descobrirExercicios(empresaId: string): Promise<number[]> {
    const rows = await this.prisma.creditoProcessamento.findMany({
      where: {
        empresaId,
        versaoPrompt:       VERSAO_P01,
        registrosBloqueados: 0,
        tabelaDestino:       'tb_ecd_saldos',
      },
      select:  { exercicio: true },
      distinct: ['exercicio'],
    });
    return rows.map(r => r.exercicio);
  }

  private async verificarP01(empresaId: string, exercicio: number): Promise<boolean> {
    const reg = await this.prisma.creditoProcessamento.findFirst({
      where: {
        empresaId, exercicio,
        versaoPrompt:       VERSAO_P01,
        registrosBloqueados: 0,
        tabelaDestino:       { in: ['tb_ecd_saldos', 'tb_ecf_registros'] },
      },
    });
    return reg !== null;
  }

  private async jaProcessado(empresaId: string, exercicio: number): Promise<boolean> {
    const reg = await this.prisma.creditoProcessamento.findFirst({
      where: {
        empresaId, exercicio,
        versaoPrompt:        VERSAO_PROMPT,
        registrosBloqueados: 0,
        tabelaDestino:       { in: ['tb_balanco', 'tb_dre'] },
      },
    });
    return reg !== null;
  }

  private async gravarProcessamento(p: {
    empresaId: string; exercicio: number; tabela: string;
    total: number; ok: number; alerta: number; bloqueados: number;
    hash: string | null; duracaoMs: number;
  }) {
    const { empresaId, exercicio, tabela: tabelaDestino,
            total, ok, alerta, bloqueados, hash, duracaoMs } = p;
    await this.prisma.creditoProcessamento.upsert({
      where: {
        empresaId_exercicio_tabelaDestino_versaoPrompt: {
          empresaId, exercicio, tabelaDestino, versaoPrompt: VERSAO_PROMPT,
        },
      },
      create: {
        empresaId, exercicio, tabelaDestino,
        totalRegistros: total, registrosOk: ok, registrosComAlerta: alerta,
        registrosBloqueados: bloqueados, hashArquivoOrigem: hash,
        timestampProcessamento: new Date(), versaoPrompt: VERSAO_PROMPT, duracaoMs,
      },
      update: {
        totalRegistros: total, registrosOk: ok, registrosComAlerta: alerta,
        registrosBloqueados: bloqueados, hashArquivoOrigem: hash,
        timestampProcessamento: new Date(), duracaoMs,
      },
    });
  }

  private async gravarInconsistencia(
    empresaId: string, exercicio: number,
    tipoErro: string, descricao: string, severidade: string,
  ) {
    await this.prisma.creditoInconsistencia.create({
      data: { empresaId, exercicio, tipoErro, descricao, severidade },
    });
  }
}
