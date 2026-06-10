import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';
import * as crypto from 'crypto';

export interface GcsArquivoMeta {
  gcsPath:    string;
  nomeArquivo: string;
  cnpj:       string;
  tipo:       'ECD' | 'ECF';
  exercicio:  number;
  // Para ECD: data_ini/data_fim do período
  periodoIni?: string;
  periodoFim?: string;
  // Para ECF: timestamp do envio (determina qual é o mais recente)
  timestampEnvio?: string;
  versao?: number;
}

const ECD_REGEX = /^ECD\/(\d{14})\/(\d{14})-(\d{8,14})-(\d{8})-(\d{8})-G-([A-F0-9]+)-(\d+)-SPED-ECD\.txt$/i;
const ECF_REGEX = /^ECF\/(\d{14})\/SPEDECF-(\d{14})-(\d{8})-(\d{8})-(\d{14})\.txt$/i;

@Injectable()
export class P01GcsService implements OnModuleInit {
  private readonly logger = new Logger(P01GcsService.name);
  private bucket!: Bucket;
  private readonly bucketName: string;

  constructor(private readonly config: ConfigService) {
    this.bucketName = this.config.get<string>('gcs.spedBucketName') ?? 'fiscal-docs-selene-prod';
  }

  onModuleInit() {
    const projectId   = this.config.get<string>('gcs.projectId');
    const keyFilename = this.config.get<string>('gcs.keyFilename');
    const opts = keyFilename ? { projectId, keyFilename } : { projectId };
    const storage = new Storage(opts);
    this.bucket = storage.bucket(this.bucketName);
    this.logger.log(`GCS configurado: bucket=${this.bucketName}`);
  }

  /** Lista todos os CNPJs disponíveis — prioridade ECF, complementado por ECD */
  async listarCnpjs(): Promise<string[]> {
    const [ecfBlobs, ecdBlobs] = await Promise.all([
      this.bucket.getFiles({ prefix: 'ECF/' }).then(([b]) => b),
      this.bucket.getFiles({ prefix: 'ECD/' }).then(([b]) => b),
    ]);
    const cnpjs = new Set<string>();
    for (const blob of [...ecfBlobs, ...ecdBlobs]) {
      const partes = blob.name.split('/');
      if (partes.length >= 3 && /^\d{14}$/.test(partes[1])) {
        cnpjs.add(partes[1]);
      }
    }
    return [...cnpjs].sort((a, b) => a.localeCompare(b));
  }

  /** Lista metadados de todos os arquivos ECD+ECF de um CNPJ */
  async listarArquivos(cnpj: string): Promise<GcsArquivoMeta[]> {
    const [ecdBlobs] = await this.bucket.getFiles({ prefix: `ECD/${cnpj}/` });
    const [ecfBlobs] = await this.bucket.getFiles({ prefix: `ECF/${cnpj}/` });

    const resultado: GcsArquivoMeta[] = [];

    for (const blob of ecdBlobs) {
      const m = ECD_REGEX.exec(blob.name);
      if (!m) continue;
      const [, cnpjEmp, , , dtIni, dtFim, , versao] = m;
      if (cnpjEmp !== cnpj) continue;
      const anoFim = parseInt(dtFim.slice(0, 4), 10);
      resultado.push({
        gcsPath:    blob.name,
        nomeArquivo: blob.name.split('/').pop()!,
        cnpj,
        tipo:       'ECD',
        exercicio:  anoFim,
        periodoIni: dtIni,
        periodoFim: dtFim,
        versao:     parseInt(versao, 10),
      });
    }

    for (const blob of ecfBlobs) {
      const m = ECF_REGEX.exec(blob.name);
      if (!m) continue;
      const [, cnpjArq, , dtIni, , timestamp] = m;
      if (cnpjArq !== cnpj) continue;
      const anoIni = parseInt(dtIni.slice(0, 4), 10);
      resultado.push({
        gcsPath:      blob.name,
        nomeArquivo:  blob.name.split('/').pop()!,
        cnpj,
        tipo:         'ECF',
        exercicio:    anoIni,
        timestampEnvio: timestamp,
      });
    }

    return resultado;
  }

  /**
   * Para cada exercício, retorna:
   *   ecf:  o arquivo ECF mais recente (maior timestamp)
   *   ecds: lista de arquivos ECD a processar (um por período,
   *         preferindo mesmo CNPJ empresa=contabilidade)
   */
  selecionarArquivosPorExercicio(
    cnpj: string,
    arquivos: GcsArquivoMeta[],
  ): Map<number, { ecf?: GcsArquivoMeta; ecds: GcsArquivoMeta[] }> {
    const porAno = new Map<number, { ecf?: GcsArquivoMeta; ecds: GcsArquivoMeta[] }>();

    // ECF: maior timestamp por exercício
    for (const a of arquivos.filter(a => a.tipo === 'ECF')) {
      const entry = porAno.get(a.exercicio) ?? { ecds: [] };
      if (!entry.ecf || (a.timestampEnvio ?? '') > (entry.ecf.timestampEnvio ?? '')) {
        entry.ecf = a;
      }
      porAno.set(a.exercicio, entry);
    }

    // ECD: por período — prefere arquivo em que cnpjEmpresa==cnpjContabilidade
    // (arquivo da própria empresa, não do escritório contábil)
    // Agrupamos por (exercicio, periodoIni-periodoFim) e escolhemos o melhor
    const ecdPorPeriodo = new Map<string, GcsArquivoMeta>();
    for (const a of arquivos.filter(a => a.tipo === 'ECD')) {
      const chave    = `${a.exercicio}|${a.periodoIni}|${a.periodoFim}`;
      const existing = ecdPorPeriodo.get(chave);

      // Extrai cnpj da contabilidade do nome do arquivo
      const m = ECD_REGEX.exec(`ECD/${cnpj}/${a.nomeArquivo}`);
      const cnpjCont = m ? m[3] : '';
      const mesmoCnpj = cnpjCont === cnpj ? 1 : 0;
      const versao    = a.versao ?? 0;

      if (!existing) {
        ecdPorPeriodo.set(chave, a);
        continue;
      }
      const mExisting = ECD_REGEX.exec(`ECD/${cnpj}/${existing.nomeArquivo}`);
      const cnpjContEx = mExisting ? mExisting[3] : '';
      const mesmoCnpjEx = cnpjContEx === cnpj ? 1 : 0;
      const versaoEx    = existing.versao ?? 0;

      if (mesmoCnpj > mesmoCnpjEx || (mesmoCnpj === mesmoCnpjEx && versao > versaoEx)) {
        ecdPorPeriodo.set(chave, a);
      }
    }

    for (const [, a] of ecdPorPeriodo) {
      const ano   = a.exercicio;
      const entry = porAno.get(ano) ?? { ecds: [] };
      entry.ecds.push(a);
      porAno.set(ano, entry);
    }

    return porAno;
  }

  /** Baixa um arquivo do bucket e retorna o buffer + hash MD5 */
  async download(gcsPath: string): Promise<{ buffer: Buffer; hash: string }> {
    const [buffer] = await this.bucket.file(gcsPath).download();
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    return { buffer, hash };
  }

  /** Faz upload de um buffer para o bucket com o path informado */
  async upload(gcsPath: string, buffer: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const file = this.bucket.file(gcsPath);
    await file.save(buffer, { contentType, resumable: false });
  }
}
