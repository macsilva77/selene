import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../../database/prisma.service';
import { NFSE_WORKER_DEFAULTS } from './nfse.types';

/**
 * Controle de NSU + lock distribuído para a distribuição de NFS-e.
 * Espelha o DfeNsuControlRepository (UPDATE atômico via SQL para serializar
 * o processamento de cada CNPJ entre múltiplos workers).
 */
@Injectable()
export class NfseNsuControlRepository {
  private readonly logger = new Logger(NfseNsuControlRepository.name);
  private readonly processId = `${hostname()}:${process.pid}`;
  private readonly lockTimeoutMs = NFSE_WORKER_DEFAULTS.lockTimeoutSegundos * 1000;

  constructor(private readonly prisma: PrismaService) {}

  /** Retorna o controle existente ou cria um novo zerado. */
  async obterOuCriarControle(configId: string, tenantId: string, cnpj: string) {
    const existente = await this.prisma.nfseNsuControle.findUnique({ where: { configId } });
    if (existente) return existente;
    return this.prisma.nfseNsuControle.create({
      data: { configId, tenantId, cnpj, ultimoNsu: '0', emProcessamento: false },
    });
  }

  /**
   * Adquire o lock de processamento via UPDATE atômico.
   * Só vence se (emProcessamento=false OU lockAte expirou).
   */
  async adquirirLock(
    controleId: string,
  ): Promise<{ adquirido: true; lockId: string } | { adquirido: false; motivo: string }> {
    const lockId = randomUUID();
    const lockAte = new Date(Date.now() + this.lockTimeoutMs);

    const afetadas = await this.prisma.$executeRaw`
      UPDATE nfse_nsu_controles
      SET em_processamento = true,
          lock_id          = ${lockId},
          lock_ate         = ${lockAte},
          lock_processo_id = ${this.processId}
      WHERE id = ${controleId}
        AND (em_processamento = false OR lock_ate < NOW())
    `;

    if (afetadas === 0) {
      const c = await this.prisma.nfseNsuControle.findUnique({
        where: { id: controleId },
        select: { lockProcessoId: true, lockAte: true },
      });
      return {
        adquirido: false,
        motivo: `Já em processamento por ${c?.lockProcessoId ?? '?'} até ${c?.lockAte?.toISOString() ?? '?'}`,
      };
    }
    this.logger.debug(`Lock NFS-e adquirido: controleId=${controleId} lockId=${lockId}`);
    return { adquirido: true, lockId };
  }

  /**
   * Libera o lock e atualiza o NSU/estatísticas em transação, verificando que
   * o lockId ainda é nosso (evita perder NSU se o lock tiver expirado).
   */
  async liberarLockEAtualizar(
    controleId: string,
    lockId: string,
    params: {
      ultimoNsu: string;
      docsBaixados: number;
      proximaConsulta?: Date | null;
      erro?: string;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.nfseNsuControle.findUnique({
        where: { id: controleId },
        select: { lockId: true },
      });
      if (c?.lockId !== lockId) {
        throw new ConflictException(
          `Lock NFS-e expirou antes da atualização (controleId=${controleId}); o lote será reprocessado.`,
        );
      }
      await tx.nfseNsuControle.update({
        where: { id: controleId },
        data: {
          ultimoNsu: params.ultimoNsu,
          emProcessamento: false,
          lockId: null,
          lockAte: null,
          lockProcessoId: null,
          ultimaConsulta: new Date(),
          ...(params.proximaConsulta !== undefined ? { proximaConsulta: params.proximaConsulta } : {}),
          errosConsecutivos: params.erro ? { increment: 1 } : 0,
          ultimoErro: params.erro ?? null,
          ultimoErroEm: params.erro ? new Date() : null,
          totalCiclos: { increment: 1 },
          totalDocBaixados: { increment: params.docsBaixados },
          ...(params.erro ? { totalErros: { increment: 1 } } : {}),
        },
      });
    });
    this.logger.debug(`Lock NFS-e liberado: controleId=${controleId} ultimoNsu=${params.ultimoNsu}`);
  }

  /** Libera locks expirados (startup / manutenção periódica). */
  async liberarLocksExpirados(): Promise<number> {
    const afetadas = await this.prisma.$executeRaw`
      UPDATE nfse_nsu_controles
      SET em_processamento = false, lock_id = NULL, lock_ate = NULL, lock_processo_id = NULL
      WHERE em_processamento = true AND lock_ate < NOW()
    `;
    if ((afetadas as number) > 0) this.logger.warn(`Locks NFS-e expirados liberados: ${afetadas}`);
    return afetadas as number;
  }
}
