import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, File } from '@google-cloud/storage';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable, Writable } from 'stream';

export interface SignedUrlOptions {
  /** Data/hora de expiração */
  expires: Date;
  /** Nome original do arquivo — define Content-Disposition na URL assinada */
  filename?: string;
}

export interface GcsFileInfo {
  exists: boolean;
  /** SHA-256 hex calculado via stream (somente se exists=true) */
  sha256?: string;
}

/**
 * Wrapper leve sobre @google-cloud/storage.
 * Expõe apenas o que o módulo obrigacoes-acessorias precisa:
 *   - verificar existência de arquivo
 *   - calcular SHA-256 via stream (sem carregar o arquivo inteiro em memória)
 */
@Injectable()
export class GcsService {
  private readonly logger = new Logger(GcsService.name);
  private readonly storage: Storage;

  constructor(private readonly config: ConfigService) {
    const projectId   = this.config.get<string>('gcs.projectId')   ?? '';
    const keyFilename = this.config.get<string>('gcs.keyFilename')  ?? '';
    this.storage = new Storage({
      projectId,
      ...(keyFilename ? { keyFilename } : {}),
    });
  }

  /**
   * Parseia caminho_bucket: "bucket-name/path/to/file" → { bucket, filePath }
   * Aceita também caminhos sem bucket prefix (usa GCS_BUCKET_NAME como default).
   */
  parseCaminho(caminhoBucket: string): { bucket: string; filePath: string } {
    const defaultBucket = this.config.get<string>('gcs.bucketName') ?? '';
    // Normaliza: remove prefixo "gs://" se presente
    const path = caminhoBucket.startsWith('gs://')
      ? caminhoBucket.slice(5)
      : caminhoBucket;
    const slashIdx = path.indexOf('/');
    if (slashIdx === -1) {
      return { bucket: defaultBucket, filePath: path };
    }
    return { bucket: path.slice(0, slashIdx), filePath: path.slice(slashIdx + 1) };
  }

  /**
   * Verifica existência e calcula SHA-256 via stream em uma única passagem.
   * RN-06 + RN-07: não carrega o arquivo inteiro em memória.
   */
  async verificarArquivo(caminhoBucket: string): Promise<GcsFileInfo> {
    const { bucket, filePath } = this.parseCaminho(caminhoBucket);
    const file: File = this.storage.bucket(bucket).file(filePath);

    const [exists] = await file.exists();
    if (!exists) {
      return { exists: false };
    }

    const sha256 = await this.calcularSha256Stream(file);
    return { exists: true, sha256 };
  }

  /**
   * Gera uma Signed URL de leitura (RN-15 — validade 15 minutos por padrão).
   * NÃO expõe o caminho real do GCS ao chamador.
   */
  async gerarSignedUrl(caminhoBucket: string, options: SignedUrlOptions): Promise<string> {
    const { bucket, filePath } = this.parseCaminho(caminhoBucket);
    const file = this.storage.bucket(bucket).file(filePath);
    const [url] = await file.getSignedUrl({
      action:  'read',
      expires: options.expires,
      ...(options.filename
        ? { responseDisposition: `attachment; filename="${options.filename}"` }
        : {}),
    });
    return url;
  }

  /**
   * Faz upload de um buffer para o GCS.
   * RN-12: usado pelo fluxo de Upload Manual.
   */
  async uploadBuffer(caminhoBucket: string, buffer: Buffer, contentType: string): Promise<void> {
    const { bucket, filePath } = this.parseCaminho(caminhoBucket);
    const file = this.storage.bucket(bucket).file(filePath);
    await file.save(buffer, { contentType });
    this.logger.log(`Upload concluído: gs://${bucket}/${filePath} (${buffer.byteLength} bytes)`);
  }

  /**
   * Cria um Readable stream do arquivo no GCS.
   * Usado para download via proxy (sem Signed URL).
   */
  criarReadStream(caminhoBucket: string): Readable {
    const { bucket, filePath } = this.parseCaminho(caminhoBucket);
    return this.storage.bucket(bucket).file(filePath).createReadStream();
  }

  /** Retorna o nome do bucket padrão configurado. */
  getDefaultBucket(): string {
    return this.config.get<string>('gcs.bucketName') ?? '';
  }

  private async calcularSha256Stream(file: File): Promise<string> {
    const hash = createHash('sha256');

    const hashWriter = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback();
      },
    });

    const readStream = file.createReadStream();
    await pipeline(readStream, hashWriter);

    return hash.digest('hex');
  }
}
