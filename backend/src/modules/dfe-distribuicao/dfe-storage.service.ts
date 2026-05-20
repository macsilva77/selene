import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

/**
 * Serviço de armazenamento de XMLs DFe no Google Cloud Storage.
 *
 * Quando GCS_BUCKET_NAME não está configurado (ambiente local sem GCS),
 * o serviço opera em modo desabilitado — `resolverXml` usa o fallback do
 * campo `xmlOriginal` no banco, sem lançar erro.
 *
 * Credenciais: usa Application Default Credentials (ADC) automaticamente.
 *  - Cloud Run: usa a service account do serviço
 *  - Local: usa GOOGLE_APPLICATION_CREDENTIALS ou `gcloud auth application-default login`
 */
@Injectable()
export class DfeStorageService {
  private readonly logger = new Logger(DfeStorageService.name);
  private readonly storage?: Storage;
  private readonly bucketName?: string;

  constructor(private readonly config: ConfigService) {
    const bucketName = this.config.get<string>('gcs.bucketName');

    if (bucketName) {
      const projectId = this.config.get<string>('gcs.projectId') || undefined;
      this.storage = new Storage({ projectId });
      this.bucketName = bucketName;
      this.logger.log(`GCS habilitado — bucket=${bucketName}`);
    } else {
      this.logger.warn('GCS_BUCKET_NAME não configurado — XMLs serão armazenados no banco');
    }
  }

  get isEnabled(): boolean {
    return !!this.bucketName;
  }

  /** Caminho canônico do XML no bucket: xmls/{tenantId}/{cnpj}/{nsu}.xml */
  xmlPath(tenantId: string, cnpj: string, nsu: string): string {
    return `xmls/${tenantId}/${cnpj}/${nsu}.xml`;
  }

  async upload(path: string, content: Buffer): Promise<void> {
    this.assertEnabled();
    await this.storage!.bucket(this.bucketName!).file(path).save(content, {
      contentType: 'application/xml',
      resumable: false,
      metadata: { cacheControl: 'no-store' },
    });
  }

  async download(path: string): Promise<Buffer> {
    this.assertEnabled();
    const [content] = await this.storage!.bucket(this.bucketName!).file(path).download();
    return content as Buffer;
  }

  /**
   * URL assinada para download direto do GCS — válida por `expiresMs` ms (padrão 5min).
   * Requer que a service account tenha permissão `roles/iam.serviceAccountTokenCreator`.
   */
  async signedDownloadUrl(path: string, expiresMs = 5 * 60_000): Promise<string> {
    this.assertEnabled();
    const [url] = await this.storage!.bucket(this.bucketName!).file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresMs,
    });
    return url;
  }

  /**
   * Resolve o XML de um documento — prioriza GCS se `xmlStoragePath` estiver preenchido,
   * com fallback para o blob `xmlOriginal` do banco (documentos migrados anteriormente).
   */
  async resolverXml(doc: {
    xmlOriginal?: Buffer | Uint8Array | null;
    xmlStoragePath?: string | null;
  }): Promise<Buffer> {
    if (doc.xmlStoragePath && this.isEnabled) {
      return this.download(doc.xmlStoragePath);
    }

    if (doc.xmlOriginal) {
      return Buffer.isBuffer(doc.xmlOriginal)
        ? doc.xmlOriginal
        : Buffer.from(doc.xmlOriginal);
    }

    throw new Error('XML indisponível: sem xmlStoragePath e sem xmlOriginal no banco');
  }

  private assertEnabled(): void {
    if (!this.isEnabled) {
      throw new Error('DfeStorageService: GCS_BUCKET_NAME não configurado');
    }
  }
}
