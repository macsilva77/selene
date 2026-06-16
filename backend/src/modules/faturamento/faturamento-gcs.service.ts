import { Injectable, Logger, OnModuleInit, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

@Injectable()
export class FaturamentoGcsService implements OnModuleInit {
  private readonly logger = new Logger(FaturamentoGcsService.name);
  private storage!: Storage;
  private allowedBucket!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId   = this.config.get<string>('gcs.projectId');
    const keyFilename = this.config.get<string>('gcs.keyFilename');
    const opts = keyFilename ? { projectId, keyFilename } : { projectId };
    this.storage = new Storage(opts);
    this.allowedBucket = this.config.get<string>('gcs.spedBucketName') ?? '';
    this.logger.log(`FaturamentoGcsService: GCS inicializado (bucket permitido: ${this.allowedBucket})`);
  }

  // 500 MB — arquivos SPED legítimos raramente passam de 100 MB
  private static readonly MAX_BYTES = 500 * 1024 * 1024;

  /** Baixa um arquivo a partir do URI gs://bucket/path. Rejeita buckets fora do configurado e arquivos > 500 MB. */
  async downloadFromUri(gcsUri: string): Promise<Buffer> {
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
    this.logger.debug(`Baixando EFD: path=${filePath} size=${size}`);
    const [buffer] = await file.download();
    return buffer;
  }
}

function parseGcsUri(uri: string): { bucket: string; filePath: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error(`URI GCS inválido: ${uri}`);
  return { bucket: match[1]!, filePath: match[2]! };
}
