import { Injectable, Logger } from '@nestjs/common';
import { createDecipheriv } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { CERT_CACHE_TTL_MS } from '../../common/constants';

interface CertCache {
  pemCert: string;
  pemKey: string;
  expiresAt: Date;
}

/**
 * Responsável por carregar o certificado PEM descriptografado do banco.
 *
 * O cert público e a chave privada são extraídos do PFX no momento da
 * importação e armazenados separadamente (certPemEnc/keyPemEnc) com
 * AES-256-GCM. Isso elimina a necessidade de reter a senha do PFX.
 *
 * Resultados são cacheados por 10 minutos para reduzir operações de crypto.
 */
@Injectable()
export class DfeCertLoaderService {
  private readonly logger = new Logger(DfeCertLoaderService.name);
  /** Cache: chave = `${tenantId}:${configId}` */
  private readonly cache = new Map<string, CertCache>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
  ) {}

  /**
   * Retorna o certificado PEM e a chave privada PEM para uso em
   * conexões mTLS com a SEFAZ.
   */
  async loadCert(tenantId: string, configId: string): Promise<{ pemCert: string; pemKey: string }> {
    const cacheKey = `${tenantId}:${configId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) {
      return { pemCert: cached.pemCert, pemKey: cached.pemKey };
    }

    const config = await this.prisma.dfeConfig.findUniqueOrThrow({
      where: { id: configId },
      include: { certificado: true },
    });

    const { certificado } = config;

    if (!certificado.certPemEnc || !certificado.certPemIv) {
      throw new Error(
        `Certificado ${config.certificadoId} não possui PEM armazenado. ` +
          'Reimporte o certificado para gerar os dados PEM.',
      );
    }
    if (!certificado.keyPemEnc || !certificado.keyPemIv) {
      throw new Error(
        `Certificado ${config.certificadoId} não possui chave privada PEM. ` +
          'Reimporte o certificado para gerar os dados PEM.',
      );
    }

    const encKey = this.getEncKey();

    const pemCert = this.decrypt(certificado.certPemEnc, certificado.certPemIv, encKey).toString('utf8');
    const pemKey = this.decrypt(certificado.keyPemEnc, certificado.keyPemIv, encKey).toString('utf8');

    this.cache.set(cacheKey, { pemCert, pemKey, expiresAt: new Date(Date.now() + CERT_CACHE_TTL_MS) });

    this.logger.debug(`Certificado PEM carregado para configId=${configId}`);

    return { pemCert, pemKey };
  }

  /** Invalida o cache para uma configuração específica (ex: após troca de cert). */
  invalidate(tenantId: string, configId: string): void {
    this.cache.delete(`${tenantId}:${configId}`);
  }

  private decrypt(encData: Buffer, storageIv: string, key: Buffer): Buffer {
    const [ivHex, authTagHex] = storageIv.split(':');
    if (!ivHex || !authTagHex) throw new Error('storageIv inválido');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encData), decipher.final()]);
  }

  private getEncKey(): Buffer {
    const hex = this.appConfig.certEncryptionKey;
    if (hex?.length !== 64) {
      throw new Error('CERT_ENCRYPTION_KEY não configurada ou inválida (esperado: 64 chars hex)');
    }
    return Buffer.from(hex, 'hex');
  }
}


