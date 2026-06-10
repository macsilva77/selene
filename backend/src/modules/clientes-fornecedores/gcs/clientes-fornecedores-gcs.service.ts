import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';

@Injectable()
export class ClientesFornecedoresGcsService implements OnModuleInit {
  private readonly logger = new Logger(ClientesFornecedoresGcsService.name);
  private storage!: Storage;
  private parquetBucket!: Bucket;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const projectId   = this.config.get<string>('gcs.projectId');
    const keyFilename = this.config.get<string>('gcs.keyFilename');
    const opts = keyFilename ? { projectId, keyFilename } : { projectId };
    this.storage = new Storage(opts);

    const bucketName = this.config.get<string>('gcs.bucketName') ?? '';
    this.parquetBucket = this.storage.bucket(bucketName);
    this.logger.log(`GCS configurado: parquet bucket=${bucketName}`);
  }

  /** Baixa um arquivo de qualquer bucket a partir do URI gs://bucket/path */
  async downloadFromUri(gcsUri: string): Promise<Buffer> {
    const { bucket, filePath } = parseGcsUri(gcsUri);
    const [buffer] = await this.storage.bucket(bucket).file(filePath).download();
    return buffer;
  }

  /**
   * Grava Parquet particionado com overwrite atômico.
   * Usa filename determinístico `dados.parquet` — GCS PUT é atômico por objeto,
   * eliminando a race condition do padrão limpar→gravar com UUID.
   *
   * Path: clientes_fornecedores/empresa_id={id}/ano={ano}/mes={MM}/tipo_participante={tipo}/dados.parquet
   */
  async salvarParticao(
    empresaId: string,
    ano: number,
    mes: number,
    tipoParticipante: 'CLIENTE' | 'FORNECEDOR',
    buffer: Buffer,
  ): Promise<string> {
    const prefix = buildPartitionPrefix(empresaId, ano, mes, tipoParticipante);
    const gcsPath = `${prefix}dados.parquet`;
    await this.parquetBucket.file(gcsPath).save(buffer, {
      contentType: 'application/octet-stream',
      resumable: false,
    });
    this.logger.debug(`Parquet salvo: ${gcsPath} (${buffer.length} bytes)`);
    return gcsPath;
  }

  /** Remove todos os arquivos de uma partição (overwrite atômico). */
  async limparParticao(
    empresaId: string,
    ano: number,
    mes: number,
    tipoParticipante: 'CLIENTE' | 'FORNECEDOR',
  ): Promise<void>;
  async limparParticao(prefix: string): Promise<void>;
  async limparParticao(
    empresaIdOrPrefix: string,
    ano?: number,
    mes?: number,
    tipoParticipante?: 'CLIENTE' | 'FORNECEDOR',
  ): Promise<void> {
    const prefix =
      ano !== undefined
        ? buildPartitionPrefix(empresaIdOrPrefix, ano, mes!, tipoParticipante!)
        : empresaIdOrPrefix;

    const [files] = await this.parquetBucket.getFiles({ prefix });
    if (files.length === 0) return;
    await Promise.all(files.map((f) => f.delete().catch(() => {})));
    this.logger.debug(`Partição limpa: ${files.length} arquivo(s) removidos (prefix=${prefix})`);
  }

  /**
   * Lista os GCS paths de todos os Parquet de uma empresa/período/tipo.
   * Itera mês a mês no intervalo [anoInicio/mesInicio .. anoFim/mesFim].
   */
  async listarParticao(
    empresaId: string,
    anoInicio: number,
    mesInicio: number,
    anoFim: number,
    mesFim: number,
    tipoParticipante: 'CLIENTE' | 'FORNECEDOR',
  ): Promise<string[]> {
    const paths: string[] = [];
    let ano = anoInicio;
    let mes = mesInicio;

    while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
      const prefix = buildPartitionPrefix(empresaId, ano, mes, tipoParticipante);
      const [files] = await this.parquetBucket.getFiles({ prefix });
      paths.push(...files.map((f) => f.name));
      mes++;
      if (mes > 12) { mes = 1; ano++; }
    }

    return paths;
  }

  getBucketName(): string {
    return this.config.get<string>('gcs.bucketName') ?? '';
  }
}

export function buildPartitionPrefix(
  empresaId: string,
  ano: number,
  mes: number,
  tipoParticipante: string,
): string {
  const mesPad = String(mes).padStart(2, '0');
  return `clientes_fornecedores/empresa_id=${empresaId}/ano=${ano}/mes=${mesPad}/tipo_participante=${tipoParticipante}/`;
}

function parseGcsUri(uri: string): { bucket: string; filePath: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error(`URI GCS inválido: ${uri}`);
  return { bucket: match[1], filePath: match[2] };
}
