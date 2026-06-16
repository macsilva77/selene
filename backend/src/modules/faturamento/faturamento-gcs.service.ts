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

  /** Baixa um arquivo a partir do URI gs://bucket/path. Rejeita buckets fora do configurado. */
  async downloadFromUri(gcsUri: string): Promise<Buffer> {
    const { bucket, filePath } = parseGcsUri(gcsUri);
    if (this.allowedBucket && bucket !== this.allowedBucket) {
      throw new ForbiddenException(`Bucket GCS não autorizado: ${bucket}`);
    }
    this.logger.debug(`Baixando EFD: path=${filePath}`);
    const [buffer] = await this.storage.bucket(bucket).file(filePath).download();
    return buffer;
  }
}

function parseGcsUri(uri: string): { bucket: string; filePath: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error(`URI GCS inválido: ${uri}`);
  return { bucket: match[1]!, filePath: match[2]! };
}
