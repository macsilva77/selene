import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Readable } from 'stream';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { GcsService } from './gcs.service';
import { UploadObrigacaoDto } from './dto/upload-obrigacao.dto';
import {
  TipoObrigacao,
  FinalidadeObrigacao,
  StatusProcessamento,
  OrigemObrigacao,
} from './enums/obrigacao-acessoria.enums';
import { QueryObrigacaoDto } from './dto/query-obrigacao.dto';
import { ObrigacaoEventoDto } from './dto/obrigacao-evento.dto';
import { Prisma } from '@prisma/client';

/** Resultado retornado ao consumer para controlar ack/nack */
export interface ProcessarEventoResult {
  /** Sempre true nesta camada — consumer deve sempre ack */
  ack: true;
  status: StatusProcessamento.RECEBIDO | StatusProcessamento.ERRO_VALIDACAO;
}

@Injectable()
export class ObrigacoesAcessoriasService {
  private readonly logger = new Logger(ObrigacoesAcessoriasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcsService: GcsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Processa evento Pub/Sub de obrigacao_recebida.
   *
   * - RN-01: consome o payload publicado no tópico
   * - RN-02: mensagens inválidas persistem Erro_Validacao e retornam ack=true
   * - RN-03/RN-04: validação via class-validator (inclui IE obrigatório p/ EFD_ICMS_IPI)
   * - RN-08: idEvento Processado → ignora; idEvento Erro_* + válido → atualiza para Recebido
   *
   * NÃO define versao/versao_atual/obrigacao_pai_id (responsabilidade da iteração 3).
   */
  async processarEventoPubSub(raw: Record<string, unknown>): Promise<ProcessarEventoResult> {
    const dataRecebimento = new Date();
    const dto = plainToInstance(ObrigacaoEventoDto, raw);
    const errors = await validate(dto, { whitelist: true });
    const isValid = errors.length === 0;

    const idEvento: string = typeof raw['IdEvento'] === 'string' ? raw['IdEvento'] : '';
    const cnpj: string     = typeof raw['CNPJ']     === 'string' ? raw['CNPJ']     : '';

    if (!isValid) {
      const detail = errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ');
      this.logger.warn(`[${idEvento || 'sem-id'}] Payload inválido — ${detail}`);

      // RN-02: persiste Erro_Validacao (best-effort); se não tiver idEvento, usa UUID aleatório
      const idParaPersistir = idEvento || crypto.randomUUID();
      await this.persistirErroValidacao(idParaPersistir, cnpj, dataRecebimento, detail);
      return { ack: true, status: StatusProcessamento.ERRO_VALIDACAO };
    }

    // A partir daqui o DTO é válido
    const idEventoValido = dto.IdEvento;

    // RN-08: verificar idempotência
    const existente = await this.prisma.obrigacaoAcessoria.findUnique({
      where: { idEvento: idEventoValido },
    });

    if (existente) {
      if (existente.statusProcessamento === StatusProcessamento.PROCESSADO) {
        this.logger.debug(`[${dto.CNPJ}] idEvento ${idEventoValido} já Processado — ignorando (RN-08)`);
        return { ack: true, status: StatusProcessamento.RECEBIDO };
      }

      // idEvento em status Erro_* → reprocessar: atualiza para Recebido
      this.logger.log(
        `[${dto.CNPJ}] idEvento ${idEventoValido} estava ${existente.statusProcessamento} — atualizando para Recebido (RN-08)`,
      );
      await this.prisma.obrigacaoAcessoria.update({
        where: { id: existente.id },
        data: {
          statusProcessamento:   StatusProcessamento.RECEBIDO,
          dataRecebimentoEvento: dataRecebimento,
          atualizadoPor:         'pubsub-consumer',
        },
      });
      return { ack: true, status: StatusProcessamento.RECEBIDO };
    }

    // Novo registro
    await this.prisma.obrigacaoAcessoria.create({
      data: {
        idEvento:              idEventoValido,
        tipoObrigacao:         dto.TipoObrigacao as string,
        cnpj:                  dto.CNPJ,
        inscricaoEstadual:     dto.InscricaoEstadual ?? null,
        dataInicial:           new Date(dto.DataInicial),
        dataFinal:             new Date(dto.DataFinal),
        finalidade:            dto.Finalidade as string,
        hash:                  dto.Hash,
        dataEntrega:           new Date(dto.DataEntrega),
        nomeArquivo:           dto.NomeArquivo,
        caminhoBucket:         dto.CaminhoBucket,
        statusProcessamento:   StatusProcessamento.RECEBIDO,
        origem:                OrigemObrigacao.TOPICO,
        dataRecebimentoEvento: dataRecebimento,
        atualizadoPor:         'pubsub-consumer',
      },
    });

    this.logger.log(
      `[${dto.CNPJ}] ${dto.TipoObrigacao} ${dto.DataInicial}→${dto.DataFinal} ` +
      `finalidade=${dto.Finalidade} idEvento=${idEventoValido} → Recebido`,
    );
    return { ack: true, status: StatusProcessamento.RECEBIDO };
  }

  private async persistirErroValidacao(
    idEvento: string,
    cnpj: string,
    dataRecebimento: Date,
    detalhe: string,
  ): Promise<void> {
    const placeholder = new Date('1970-01-01');
    try {
      // Se já existe com qualquer status (ex: Processado), não sobrescreve
      const existente = await this.prisma.obrigacaoAcessoria.findUnique({ where: { idEvento } });
      if (existente?.statusProcessamento === StatusProcessamento.PROCESSADO) return;

      if (existente) {
        await this.prisma.obrigacaoAcessoria.update({
          where: { id: existente.id },
          data: {
            statusProcessamento:   StatusProcessamento.ERRO_VALIDACAO,
            dataRecebimentoEvento: dataRecebimento,
            atualizadoPor:         'pubsub-consumer',
          },
        });
      } else {
        await this.prisma.obrigacaoAcessoria.create({
          data: {
            idEvento,
            tipoObrigacao:         '',
            cnpj:                  cnpj || '',
            dataInicial:           placeholder,
            dataFinal:             placeholder,
            finalidade:            '',
            hash:                  detalhe.slice(0, 64).padEnd(64, '0'),
            dataEntrega:           dataRecebimento,
            nomeArquivo:           '',
            caminhoBucket:         '',
            statusProcessamento:   StatusProcessamento.ERRO_VALIDACAO,
            origem:                OrigemObrigacao.TOPICO,
            dataRecebimentoEvento: dataRecebimento,
            atualizadoPor:         'pubsub-consumer',
          },
        });
      }
    } catch (err) {
      this.logger.error(`Falha ao persistir Erro_Validacao para ${idEvento}: ${String(err)}`);
    }
  }

  /**
   * Atualiza o status de processamento (chamado pelo worker de processamento).
   */
  async atualizarStatus(
    id: string,
    status: StatusProcessamento,
    atualizadoPor: string,
  ): Promise<void> {
    await this.prisma.obrigacaoAcessoria.update({
      where: { id },
      data: { statusProcessamento: status as string, atualizadoPor },
    });
  }

  /**
   * Processa evento com lógica de versionamento/retificação (iteração 3).
   * @deprecated Substituído por processarEventoPubSub para o consumer.
   * Mantido para referência — será expandido na próxima iteração.
   */
  async processarEvento(payload: {
    idEvento: string; tipoObrigacao: string; cnpj: string;
    inscricaoEstadual?: string | null; dataInicial: string; dataFinal: string;
    finalidade: string; hash: string; dataEntrega: string; nomeArquivo: string;
    caminhoBucket: string; origem?: string; atualizadoPor?: string;
    dataRecebimentoEvento?: string;
  }): Promise<void> {
    const tipoObrigacao  = payload.tipoObrigacao as TipoObrigacao;
    const finalidade     = payload.finalidade    as FinalidadeObrigacao;
    const origem         = (payload.origem ?? OrigemObrigacao.TOPICO) as OrigemObrigacao;
    const atualizadoPor  = payload.atualizadoPor ?? 'sistema';
    const dataRecebimento = payload.dataRecebimentoEvento
      ? new Date(payload.dataRecebimentoEvento) : new Date();

    if (!Object.values(TipoObrigacao).includes(tipoObrigacao)) return;
    if (!Object.values(FinalidadeObrigacao).includes(finalidade)) return;

    const existente = await this.prisma.obrigacaoAcessoria.findUnique({
      where: { idEvento: payload.idEvento },
    });
    if (existente) return;

    await this.prisma.$transaction(async (tx) => {
      let obrigacaoPaiId: string | null = null;
      let versao = 1;

      if (finalidade !== FinalidadeObrigacao.ORIGINAL) {
        const versaoAtual = await tx.obrigacaoAcessoria.findFirst({
          where: {
            cnpj: payload.cnpj, tipoObrigacao: tipoObrigacao as string,
            dataInicial: new Date(payload.dataInicial), dataFinal: new Date(payload.dataFinal),
            versaoAtual: true,
          },
          orderBy: { versao: 'desc' },
        });
        if (versaoAtual) {
          await tx.obrigacaoAcessoria.update({
            where: { id: versaoAtual.id }, data: { versaoAtual: false },
          });
          obrigacaoPaiId = versaoAtual.obrigacaoPaiId ?? versaoAtual.id;
          versao = versaoAtual.versao + 1;
        }
      }

      await tx.obrigacaoAcessoria.create({
        data: {
          idEvento: payload.idEvento, tipoObrigacao: tipoObrigacao as string,
          cnpj: payload.cnpj, inscricaoEstadual: payload.inscricaoEstadual ?? null,
          dataInicial: new Date(payload.dataInicial), dataFinal: new Date(payload.dataFinal),
          finalidade: finalidade as string, hash: payload.hash,
          dataEntrega: new Date(payload.dataEntrega), nomeArquivo: payload.nomeArquivo,
          caminhoBucket: payload.caminhoBucket, statusProcessamento: StatusProcessamento.RECEBIDO,
          origem: origem as string, versao, versaoAtual: true,
          dataRecebimentoEvento: dataRecebimento, obrigacaoPaiId, atualizadoPor,
        },
      });
    });
  }

  /**
   * Consulta paginada com filtros.
   */
  async listar(query: QueryObrigacaoDto) {
    const {
      cnpj,
      tipoObrigacao,
      statusProcessamento,
      finalidade,
      dataRef,
      page = 1,
    } = query;
    const limit = query.size ?? query.limit ?? 20;
    // versaoAtual: se não especificado, mostra todas as versões (RN-10)
    const versaoAtual = query.versaoAtual;

    const where: Prisma.ObrigacaoAcessoriaWhereInput = {
      ...(cnpj              ? { cnpj }                                                    : {}),
      ...(tipoObrigacao     ? { tipoObrigacao: tipoObrigacao as string }                  : {}),
      ...(statusProcessamento ? { statusProcessamento: statusProcessamento as string }   : {}),
      ...(finalidade        ? { finalidade: finalidade as string }                        : {}),
      ...(versaoAtual !== undefined ? { versaoAtual }                                     : {}),
      ...(dataRef ? {
        dataInicial: { lte: new Date(dataRef) },
        dataFinal:   { gte: new Date(dataRef) },
      } : {
        ...(query.dataInicial ? { dataInicial: { gte: new Date(query.dataInicial) } } : {}),
        ...(query.dataFinal   ? { dataFinal:   { lte: new Date(query.dataFinal)   } } : {}),
      }),
    };

    const [total, items] = await Promise.all([
      this.prisma.obrigacaoAcessoria.count({ where }),
      this.prisma.obrigacaoAcessoria.findMany({
        where,
        orderBy: [{ dataEntrega: 'desc' }, { criadoEm: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  /** Retorna o histórico de versões (original + retificações) para um CNPJ+tipo+período. */
  async historico(cnpj: string, tipoObrigacao: string, dataInicial: string, dataFinal: string) {
    return this.prisma.obrigacaoAcessoria.findMany({
      where: {
        cnpj,
        tipoObrigacao,
        dataInicial: new Date(dataInicial),
        dataFinal:   new Date(dataFinal),
      },
      orderBy: { versao: 'asc' },
    });
  }

  /** Retorna dashboard de contagens por status. */
  async dashboard() {
    const rows = await this.prisma.obrigacaoAcessoria.groupBy({
      by:       ['statusProcessamento', 'tipoObrigacao'],
      where:    { versaoAtual: true },
      _count:   { id: true },
    });

    return rows.map((r) => ({
      tipoObrigacao:      r.tipoObrigacao,
      statusProcessamento: r.statusProcessamento,
      total:              r._count.id,
    }));
  }

  /**
   * Upload manual de arquivo para GCS e criação do registro.
   * RN-12: Origem = Upload_Manual; hash calculado do buffer; não editável pelo usuário.
   */
  async uploadManual(
    dto: UploadObrigacaoDto,
    buffer: Buffer,
    originalname: string,
  ): Promise<{ id: string }> {
    const idEvento = crypto.randomUUID();
    const hash = createHash('sha256').update(buffer).digest('hex');
    const bucketName = this.gcsService.getDefaultBucket();
    const caminhoRelativo = `cnpj=${dto.cnpj}/${idEvento}/${originalname}`;
    const caminhoBucket = `${bucketName}/${caminhoRelativo}`;

    await this.gcsService.uploadBuffer(caminhoBucket, buffer, 'text/plain');

    const record = await this.prisma.obrigacaoAcessoria.create({
      data: {
        idEvento,
        tipoObrigacao:         dto.tipoObrigacao as string,
        cnpj:                  dto.cnpj,
        inscricaoEstadual:     dto.inscricaoEstadual ?? null,
        dataInicial:           new Date(dto.dataInicial),
        dataFinal:             new Date(dto.dataFinal),
        finalidade:            dto.finalidade as string,
        hash,
        dataEntrega:           new Date(),
        nomeArquivo:           originalname,
        caminhoBucket,
        statusProcessamento:   StatusProcessamento.RECEBIDO,
        origem:                OrigemObrigacao.UPLOAD_MANUAL,
        dataRecebimentoEvento: new Date(),
        atualizadoPor:         'upload-manual',
      },
    });

    this.logger.log(`[${dto.cnpj}] Upload manual ${dto.tipoObrigacao} idEvento=${idEvento}`);
    return { id: record.id };
  }

  /**
   * Gera URL pré-assinada do GCS para download seguro (RN-15 — 15 minutos).
   * NÃO expõe o caminho real do GCS no retorno.
   */
  async gerarDownloadUrl(id: string): Promise<{ url: string; expiresAt: string }> {
    const record = await this.prisma.obrigacaoAcessoria.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Obrigação não encontrada: ${id}`);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const url = await this.gcsService.gerarSignedUrl(record.caminhoBucket, {
      expires: expiresAt,
      filename: record.nomeArquivo,
    });
    return { url, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Retorna stream do arquivo + nome original para download via proxy.
   * Alternativa à Signed URL — não requer iam.serviceAccounts.signBlob.
   */
  async downloadArquivo(id: string): Promise<{ stream: Readable; nomeArquivo: string }> {
    const record = await this.prisma.obrigacaoAcessoria.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Obrigação não encontrada: ${id}`);
    return {
      stream:      this.gcsService.criarReadStream(record.caminhoBucket),
      nomeArquivo: record.nomeArquivo,
    };
  }
}
