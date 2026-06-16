import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';

@Injectable()
export class FaturamentoGcsService implements OnModuleInit {
  private readonly logger = new Logger(FaturamentoGcsService.name);
  private storage!: Storage;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId   = this.config.get<string>('gcs.projectId');
    const keyFilename = this.config.get<string>('gcs.keyFilename');
    const opts = keyFilename ? { projectId, keyFilename } : { projectId };
    this.storage = new Storage(opts);
    this.logger.log('FaturamentoGcsService: GCS inicializado');
  }

  /** Baixa um arquivo a partir do URI gs://bucket/path */
  async downloadFromUri(gcsUri: string): Promise<Buffer> {
    const { bucket, filePath } = parseGcsUri(gcsUri);
    this.logger.debug(`Baixando EFD: bucket=${bucket} path=${filePath}`);
    const [buffer] = await this.storage.bucket(bucket).file(filePath).download();
    return buffer;
  }
}

function parseGcsUri(uri: string): { bucket: string; filePath: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error(`URI GCS inválido: ${uri}`);
  return { bucket: match[1]!, filePath: match[2]! };
}
