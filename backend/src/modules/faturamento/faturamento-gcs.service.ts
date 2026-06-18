import { Injectable, Logger, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import type { Readable } from 'node:stream';

export interface SpedStream {
  /** Stream lazy do arquivo — consumir apenas uma vez. */
  stream: Readable;
  /** MD5 hex fornecido pelo GCS (computado no upload, sem custo extra). */
  hashArquivo: string;
  /** Tamanho em bytes, para logging. */
  size: number;
}

@Injectable()
export class FaturamentoGcsService implements OnModuleInit {
  private readonly logger = new Logger(FaturamentoGcsService.name);
  private storage!: Storage;
  private allowedBucket!: string;

  // 500 MB — arquivos SPED legítimos raramente passam de 100 MB
  private static readonly MAX_BYTES = 500 * 1024 * 1024;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId   = this.config.get<string>('gcs.projectId');
    const keyFilename = this.config.get<string>('gcs.keyFilename');
    const opts = keyFilename ? { projectId, keyFilename } : { projectId };
    this.storage = new Storage(opts);
    this.allowedBucket = this.config.get<string>('gcs.spedBucketName') ?? '';
    this.logger.log(`FaturamentoGcsService: GCS inicializado (bucket: ${this.allowedBucket})`);
  }

  /**
   * Abre um stream do arquivo GCS sem baixá-lo inteiro para a memória.
   * Verifica tamanho e bucket antes de iniciar o stream.
   * Usa o MD5 fornecido pelo GCS (calculado no upload) como hash de idempotência.
   */
  async openStream(gcsUri: string): Promise<SpedStream> {
    const { bucket, filePath } = parseGcsUri(gcsUri);

    if (this.allowedBucket && bucket !== this.allowedBucket) {
      throw new ForbiddenException(`Bucket GCS não autorizado: ${bucket}`);
    }

    const file = this.storage.bucket(bucket).file(filePath);
    const [meta] = await file.getMetadata();
    const size = Number(meta.size ?? 0);

    if (size > FaturamentoGcsService.MAX_BYTES) {
      throw new Error(`Arquivo muito grande (${size} bytes) — limite ${FaturamentoGcsService.MAX_BYTES}`);
    }

    // GCS armazena md5Hash como base64; convertemos para hex para consistência com SHA256 anterior
    const md5b64 = typeof meta.md5Hash === 'string' ? meta.md5Hash : '';
    const hashArquivo = md5b64
      ? Buffer.from(md5b64, 'base64').toString('hex')
      : '';

    this.logger.debug(`Abrindo stream SPED: path=${filePath} size=${size}`);

    return { stream: file.createReadStream(), hashArquivo, size };
  }
}

/**
 * Aceita tanto "gs://bucket/path" quanto "bucket/path" (formato gravado por
 * obrigacoes-acessorias ao receber via Pub/Sub ou upload manual).
 */
function parseGcsUri(uri: string): { bucket: string; filePath: string } {
  const normalized = uri.startsWith('gs://') ? uri.slice(5) : uri;
  const slash = normalized.indexOf('/');
  if (slash === -1) throw new Error(`URI GCS inválido (sem path): ${uri}`);
  return { bucket: normalized.slice(0, slash), filePath: normalized.slice(slash + 1) };
}
