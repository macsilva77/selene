import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import Redis from 'ioredis';

// Janela de contagem e tempo de bloqueio (segundos)
const MAX_ATTEMPTS = 5;
const LOCKOUT_TTL = 15 * 60; // 15 minutos

@Injectable()
export class TokenBlacklistService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly redis: Redis;
  private readonly BL_PREFIX   = 'jti:bl:';
  private readonly FAIL_PREFIX = 'login:fail:';
  private readonly LOCK_PREFIX = 'login:lock:';

  constructor(private readonly config: AppConfigService) {
    const redis = this.config.redis;
    this.redis = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.redis.on('error', (err: Error) =>
      this.logger.error(`Redis blacklist error: ${err.message}`),
    );
  }

  // ─── JWT Blacklist ─────────────────────────────────────────────────────────

  /** Adiciona um JTI à blacklist com TTL em segundos. */
  async blacklist(jti: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(`${this.BL_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis offline — blacklist ignorada para jti ${jti}: ${(err as Error).message}`);
    }
  }

  /** Retorna true se o JTI estiver na blacklist (token revogado). */
  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      const val = await this.redis.get(`${this.BL_PREFIX}${jti}`);
      return val !== null;
    } catch (err) {
      this.logger.warn(`Redis offline — isBlacklisted retorna false: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── Brute Force Protection ────────────────────────────────────────────────

  /**
   * Registra uma tentativa de login falha para o e-mail.
   * Quando tenantSlug é fornecido, o escopo é por tenant (evita lockout cruzado entre organizações).
   * Após MAX_ATTEMPTS falhas na janela de LOCKOUT_TTL, a conta é bloqueada.
   */
  async trackFailedLogin(email: string, tenantSlug?: string): Promise<void> {
    try {
      const scope = tenantSlug ? `${email}:${tenantSlug}` : email;
      const failKey = `${this.FAIL_PREFIX}${scope}`;
      const lockKey = `${this.LOCK_PREFIX}${scope}`;
      const count = await this.redis.incr(failKey);
      if (count === 1) {
        await this.redis.expire(failKey, LOCKOUT_TTL);
      }
      if (count >= MAX_ATTEMPTS) {
        await this.redis.set(lockKey, '1', 'EX', LOCKOUT_TTL);
        await this.redis.del(failKey);
      }
    } catch (err) {
      this.logger.warn(`Redis offline — trackFailedLogin ignorado para ${email}: ${(err as Error).message}`);
    }
  }

  /** Retorna true se o e-mail (com escopo de tenant opcional) estiver bloqueado por excesso de tentativas. */
  async isLoginLocked(email: string, tenantSlug?: string): Promise<boolean> {
    try {
      const scope = tenantSlug ? `${email}:${tenantSlug}` : email;
      const val = await this.redis.get(`${this.LOCK_PREFIX}${scope}`);
      return val !== null;
    } catch (err) {
      this.logger.warn(`Redis offline — isLoginLocked retorna false: ${(err as Error).message}`);
      return false;
    }
  }

  /** Limpa contadores após login bem-sucedido. */
  async clearLoginFailures(email: string, tenantSlug?: string): Promise<void> {
    try {
      const scope = tenantSlug ? `${email}:${tenantSlug}` : email;
      await this.redis.del(`${this.FAIL_PREFIX}${scope}`);
      await this.redis.del(`${this.LOCK_PREFIX}${scope}`);
    } catch (err) {
      this.logger.warn(`Redis offline — clearLoginFailures ignorado para ${email}: ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
