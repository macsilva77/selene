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
 * Carrega o certificado PEM descriptografado para uso no mTLS com o ADN.
 *
 * Reaproveita o mesmo armazenamento da NF-e: cert público e chave privada são
 * extraídos do PFX na importação e guardados separadamente (certPemEnc/keyPemEnc)
 * com AES-256-GCM. Aqui a busca é por certificadoId direto (a NFS-e referencia o
 * certificado por id em NfseConfig). Cacheado por 10 min.
 */
@Injectable()
export class NfseCertLoaderService {
  private readonly logger = new Logger(NfseCertLoaderService.name);
  /** Cache: chave = certificadoId */
  private readonly cache = new Map<string, CertCache>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
  ) {}

  /** Retorna o PEM do certificado e a chave privada para conexões mTLS. */
  async loadCert(certificadoId: string): Promise<{ pemCert: string; pemKey: string }> {
    const cached = this.cache.get(certificadoId);
    if (cached && cached.expiresAt > new Date()) {
      return { pemCert: cached.pemCert, pemKey: cached.pemKey };
    }

    const certificado = await this.prisma.certificadoDigital.findUniqueOrThrow({
      where: { id: certificadoId },
    });

    if (!certificado.certPemEnc || !certificado.certPemIv) {
      throw new Error(
        `Certificado ${certificadoId} não possui PEM armazenado. Reimporte o certificado.`,
      );
    }
    if (!certificado.keyPemEnc || !certificado.keyPemIv) {
      throw new Error(
        `Certificado ${certificadoId} não possui chave privada PEM. Reimporte o certificado.`,
      );
    }

    const encKey = this.getEncKey();
    const pemCert = this.decrypt(certificado.certPemEnc, certificado.certPemIv, encKey).toString('utf8');
    const pemKey = this.decrypt(certificado.keyPemEnc, certificado.keyPemIv, encKey).toString('utf8');

    this.cache.set(certificadoId, {
      pemCert,
      pemKey,
      expiresAt: new Date(Date.now() + CERT_CACHE_TTL_MS),
    });
    this.logger.debug(`Certificado PEM carregado para certificadoId=${certificadoId}`);

    return { pemCert, pemKey };
  }

  invalidate(certificadoId: string): void {
    this.cache.delete(certificadoId);
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
