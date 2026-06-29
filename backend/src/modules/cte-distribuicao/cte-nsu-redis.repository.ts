import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import Redis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { AcquisicaoLockResultado, CTE_WORKER_DEFAULTS } from './cte.types';

const NSU_KEY = (tenantId: string, cnpj: string) => `cte:nsu:${tenantId}:${cnpj}`;
const LOCK_KEY = (tenantId: string, cnpj: string) => `cte:lock:${tenantId}:${cnpj}`;

// Libera o lock somente se ainda pertence a este worker (atômico via Lua)
const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

export interface NsuState {
  ultimoNsu: string;
  maxNsu: string;
}

/**
 * Repositório de NSU do CT-e usando Redis como store primário.
 *
 * - NSU e lock ficam no Redis (rápido, sem contenção no PostgreSQL)
 * - Stats, scheduling e auditoria permanecem no PostgreSQL
 * - Bootstrap automático: se a chave Redis não existir, lê do PostgreSQL
 */
@Injectable()
export class CteNsuRedisRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CteNsuRedisRepository.name);
  private readonly processId = `${hostname()}:${process.pid}`;
  private readonly lockTtlMs = CTE_WORKER_DEFAULTS.lockTimeoutSegundos * 1000;
  private redis!: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.redis = new Redis({
      host: this.config.get<string>('redis.host') ?? 'localhost',
      port: this.config.get<number>('redis.port') ?? 6379,
      password: this.config.get<string>('redis.password') || undefined,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 1000, 10_000),
    });

    this.redis.on('error', (err: Error) =>
      this.logger.error('Redis connection error', err.message),
    );
  }

  onModuleDestroy() {
    void this.redis.quit();
  }

  // ── NSU ──────────────────────────────────────────────────────────────────────

  async lerNsu(tenantId: string, cnpj: string): Promise<NsuState> {
    const data = await this.redis.hgetall(NSU_KEY(tenantId, cnpj));

    if (data['ultimoNsu']) {
      return {
        ultimoNsu: data['ultimoNsu'],
        maxNsu: data['maxNsu'] ?? data['ultimoNsu'],
      };
    }

    return this.bootstrapFromPostgres(tenantId, cnpj);
  }

  async salvarNsu(tenantId: string, cnpj: string, ultimoNsu: string, maxNsu: string): Promise<void> {
    await this.redis.hset(NSU_KEY(tenantId, cnpj), {
      ultimoNsu,
      maxNsu,
      ultimaConsulta: new Date().toISOString(),
    });
  }

  async resetarNsu(tenantId: string, cnpj: string): Promise<void> {
    await this.redis.del(NSU_KEY(tenantId, cnpj));
    this.logger.log(`NSU zerado no Redis: ${tenantId}:${cnpj}`);
  }

  // ── Lock distribuído ──────────────────────────────────────────────────────────

  async adquirirLock(tenantId: string, cnpj: string): Promise<AcquisicaoLockResultado> {
    const lockId = randomUUID();
    const key = LOCK_KEY(tenantId, cnpj);

    const result = await this.redis.set(key, lockId, 'PX', this.lockTtlMs, 'NX');

    if (!result) {
      const detentor = await this.redis.get(key);
      return {
        adquirido: false,
        motivo: `CNPJ ${cnpj} já em processamento (lock=${detentor ?? '?'})`,
      };
    }

    this.logger.debug(`Lock adquirido: ${tenantId}:${cnpj} lockId=${lockId}`);
    return { adquirido: true, lockId };
  }

  async liberarLock(tenantId: string, cnpj: string, lockId: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY(tenantId, cnpj), lockId);
    this.logger.debug(`Lock liberado: ${tenantId}:${cnpj}`);
  }

  // ── PostgreSQL — stats e scheduling (permanecem no banco) ─────────────────────

  async incrementarDocumentosBaixados(controleId: string, quantidade: number): Promise<void> {
    await this.prisma.cteNsuControle.update({
      where: { id: controleId },
      data: { totalDocBaixados: { increment: quantidade } },
    });
  }

  async agendarProximaConsulta(controleId: string, proximaConsulta: Date): Promise<void> {
    await this.prisma.cteNsuControle.update({
      where: { id: controleId },
      data: { proximaConsulta },
    });
  }

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
      await this.prisma.cteAuditoria.create({
        data: { ...params, hostname: this.processId },
      });
    } catch (err) {
      this.logger.error('Falha ao registrar auditoria', err);
    }
  }

  // ── Rate limiting SEFAZ ───────────────────────────────────────────────────────

  private readonly THROTTLE_TTL_MS = 1_000; // janela de 1 segundo por CNPJ
  private readonly THROTTLE_MAX_ESPERA_MS = 5_000;

  /**
   * Garante no máximo 1 chamada SEFAZ por segundo por tenant+CNPJ em qualquer worker.
   * Aguarda até THROTTLE_MAX_ESPERA_MS antes de lançar (BullMQ retentará o job).
   */
  async aguardarRateLimit(tenantId: string, cnpj: string): Promise<void> {
    const key = `cte:throttle:${tenantId}:${cnpj}`;
    const inicio = Date.now();

    while (Date.now() - inicio < this.THROTTLE_MAX_ESPERA_MS) {
      const ok = await this.redis.set(key, '1', 'PX', this.THROTTLE_TTL_MS, 'NX');
      if (ok === 'OK') return;
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    throw new Error(`Rate limit SEFAZ excedido para CNPJ ${cnpj} — job será retentado`);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────

  private async bootstrapFromPostgres(tenantId: string, cnpj: string): Promise<NsuState> {
    const controle = await this.prisma.cteNsuControle.findFirst({
      where: { tenantId, cnpj },
      select: { ultimoNsu: true, maxNsu: true },
    });

    const ultimoNsu = controle?.ultimoNsu ?? '000000000000000';
    const maxNsu = controle?.maxNsu ?? '000000000000000';

    await this.salvarNsu(tenantId, cnpj, ultimoNsu, maxNsu);
    this.logger.log(`NSU bootstrap do PostgreSQL → Redis: ${tenantId}:${cnpj} ultimoNsu=${ultimoNsu}`);

    return { ultimoNsu, maxNsu };
  }
}
