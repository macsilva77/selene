import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../../database/prisma.service';
import { AcquisicaoLockResultado, DFE_WORKER_DEFAULTS } from './dfe.types';

/**
 * Repository responsável por:
 *  - Controle de NSU (criar/atualizar DfeNsuControle)
 *  - Lock distribuído atômico via SQL (evitar consultas concorrentes ao mesmo CNPJ)
 *  - Auditoria (inserir registros em DfeAuditoria)
 */
@Injectable()
export class DfeNsuControlRepository {
  private readonly logger = new Logger(DfeNsuControlRepository.name);
  private readonly processId = `${hostname()}:${process.pid}`;
  private readonly lockTimeoutMs = DFE_WORKER_DEFAULTS.lockTimeoutSegundos * 1000;

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Obter / criar controle
  // ────────────────────────────────────────────────────────────────────────────

  /** Retorna o controle NSU existente ou cria um novo zerado. */
  async obterOuCriarControle(configId: string, tenantId: string, cnpj: string) {
    const existente = await this.prisma.dfeNsuControle.findUnique({
      where: { configId },
    });
    if (existente) return existente;

    return this.prisma.dfeNsuControle.create({
      data: {
        configId,
        tenantId,
        cnpj,
        ultimoNsu: '000000000000000',
        maxNsu: '000000000000000',
        emProcessamento: false,
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Lock distribuído
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Tenta adquirir o lock de processamento para o controle NSU.
   *
   * Usa UPDATE atômico com condição no WHERE para garantir que apenas um
   * worker processa o CNPJ de cada vez. Locks expirados são ignorados.
   *
   * @returns `{ adquirido: true, lockId }` ou `{ adquirido: false, motivo }`
   */
  async adquirirLock(controleId: string): Promise<AcquisicaoLockResultado> {
    const lockId = randomUUID();
    const lockAte = new Date(Date.now() + this.lockTimeoutMs);

    // UPDATE atômico — somente funciona se (emProcessamento=false OU lockAte expirou)
    const result = await this.prisma.$executeRaw`
      UPDATE dfe_nsu_controles
      SET
        em_processamento = true,
        lock_id          = ${lockId},
        lock_ate         = ${lockAte},
        lock_processo_id = ${this.processId}
      WHERE
        id = ${controleId}
        AND (
          em_processamento = false
          OR lock_ate < NOW()
        )
    `;

    if (result === 0) {
      const controle = await this.prisma.dfeNsuControle.findUnique({
        where: { id: controleId },
        select: { lockProcessoId: true, lockAte: true },
      });
      return {
        adquirido: false,
        motivo: `Controle já está em processamento por ${controle?.lockProcessoId ?? 'desconhecido'} até ${controle?.lockAte?.toISOString() ?? '?'}`,
      };
    }

    this.logger.debug(`Lock adquirido: controleId=${controleId} lockId=${lockId}`);
    return { adquirido: true, lockId };
  }

  /**
   * Libera o lock E atualiza o NSU em uma transação atômica.
   *
   * Verifica que o lockId ainda é o mesmo antes de confirmar a atualização.
   * Isso garante que um NSU não seja perdido se o lock expirar e outro worker
   * tiver assumido entre a consulta e a atualização.
   */
  async liberarLockEAtualizarNsu(
    controleId: string,
    lockId: string,
    ultimoNsu: string,
    maxNsu: string,
    erroMensagem?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Verifica que o lock ainda é nosso
      const controle = await tx.dfeNsuControle.findUnique({
        where: { id: controleId },
        select: { lockId: true },
      });

      if (controle?.lockId !== lockId) {
        throw new ConflictException(
          `Lock expirou antes da atualização do NSU (controleId=${controleId}). ` +
            'Os NSUs deste lote NÃO foram marcados — serão reprocessados na próxima consulta.',
        );
      }

      await tx.dfeNsuControle.update({
        where: { id: controleId },
        data: {
          ultimoNsu,
          maxNsu,
          emProcessamento: false,
          lockId: null,
          lockAte: null,
          lockProcessoId: null,
          ultimaConsulta: new Date(),
          errosConsecutivos: erroMensagem ? { increment: 1 } : 0,
          ultimoErro: erroMensagem ?? null,
          ultimoErroEm: erroMensagem ? new Date() : null,
          totalLotes: { increment: 1 },
          ...(erroMensagem ? { totalErros: { increment: 1 } } : {}),
        },
      });
    });

    this.logger.debug(
      `Lock liberado: controleId=${controleId} ultimoNsu=${ultimoNsu} maxNsu=${maxNsu}`,
    );
  }

  /**
   * Atualiza estatísticas pós-ciclo no PostgreSQL (stats, erros, timestamps).
   * Chamado após o lock Redis ser liberado — não verifica lockId (Redis já validou).
   */
  async atualizarStats(
    controleId: string,
    params: { ultimoNsu: string; maxNsu: string; erro?: string },
  ): Promise<void> {
    await this.prisma.dfeNsuControle.update({
      where: { id: controleId },
      data: {
        ultimoNsu: params.ultimoNsu,
        maxNsu: params.maxNsu,
        emProcessamento: false,
        lockId: null,
        lockAte: null,
        lockProcessoId: null,
        ultimaConsulta: new Date(),
        errosConsecutivos: params.erro ? { increment: 1 } : 0,
        ultimoErro: params.erro ?? null,
        ultimoErroEm: params.erro ? new Date() : null,
        totalLotes: { increment: 1 },
        ...(params.erro ? { totalErros: { increment: 1 } } : {}),
      },
    });
  }

  /** Incrementa o contador de documentos baixados. */
  async incrementarDocumentosBaixados(controleId: string, quantidade: number): Promise<void> {
    await this.prisma.dfeNsuControle.update({
      where: { id: controleId },
      data: { totalDocBaixados: { increment: quantidade } },
    });
  }

  /**
   * Zera o NSU e libera o cooldown — permite recuperação completa dos 90 dias
   * na próxima execução do cron sem aguardar proximaConsulta agendada.
   */
  async resetarNsu(controleId: string): Promise<void> {
    await this.prisma.dfeNsuControle.update({
      where: { id: controleId },
      data: {
        ultimoNsu: '000000000000000',
        maxNsu: '000000000000000',
        proximaConsulta: null,
        emProcessamento: false,
        lockId: null,
        lockAte: null,
        errosConsecutivos: 0,
        ultimoErro: null,
        ultimoErroEm: null,
      },
    });
    this.logger.log(`Controle ${controleId}: NSU zerado, cooldown liberado — recuperação dos 90 dias iniciará no próximo ciclo`);
  }

  /** Reseta apenas os contadores de erro, sem alterar NSU. */
  async resetarErros(controleId: string): Promise<void> {
    await this.prisma.dfeNsuControle.update({
      where: { id: controleId },
      data: {
        errosConsecutivos: 0,
        ultimoErro: null,
        ultimoErroEm: null,
      },
    });
    this.logger.log(`Controle ${controleId}: circuit breaker resetado pelo usuário`);
  }

  /** Atualiza a próxima data de consulta (scheduling). */
  async agendarProximaConsulta(controleId: string, proximaConsulta: Date): Promise<void> {
    await this.prisma.dfeNsuControle.update({
      where: { id: controleId },
      data: { proximaConsulta },
    });
  }

  /**
   * Força a liberação de locks expirados.
   * Deve ser chamado no startup do worker ou periodicamente (ex: a cada hora).
   */
  async liberarLocksExpirados(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE dfe_nsu_controles
      SET
        em_processamento = false,
        lock_id          = NULL,
        lock_ate         = NULL,
        lock_processo_id = NULL
      WHERE
        em_processamento = true
        AND lock_ate < NOW()
    `;
    if (result > 0) {
      this.logger.warn(`Locks expirados liberados: ${result}`);
    }
    return result as number;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Auditoria
  // ────────────────────────────────────────────────────────────────────────────

  async registrarAuditoria(params: {
    tenantId: string;
    cnpj: string;
    operacao: string;
    nsuAntes?: string;
    nsuDepois?: string;
    cStat?: string;
    sucesso: boolean;
    detalhe?: string;
    duracaoMs?: number;
  }): Promise<void> {
    try {
      await this.prisma.dfeAuditoria.create({
        data: {
          tenantId: params.tenantId,
          cnpj: params.cnpj,
          operacao: params.operacao,
          nsuAntes: params.nsuAntes,
          nsuDepois: params.nsuDepois,
          cStat: params.cStat,
          sucesso: params.sucesso,
          detalhe: params.detalhe,
          duracaoMs: params.duracaoMs,
          hostname: this.processId,
        },
      });
    } catch (err) {
      // Auditoria nunca deve interromper o fluxo principal
      this.logger.error('Falha ao registrar auditoria:', err);
    }
  }
}
