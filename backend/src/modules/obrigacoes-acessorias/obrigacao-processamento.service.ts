import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { GcsService } from './gcs.service';
import {
  StatusProcessamento,
  FinalidadeObrigacao,
  TipoObrigacao,
} from './enums/obrigacao-acessoria.enums';

const ATUALIZADO_POR = 'obrigacao-processamento-service';

/** Resultado do processamento de um único registro */
export interface ResultadoProcessamento {
  id: string;
  idEvento: string;
  statusFinal: StatusProcessamento;
}

@Injectable()
export class ObrigacaoProcessamentoService {
  private readonly logger = new Logger(ObrigacaoProcessamentoService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly gcs:           GcsService,
    private readonly eventEmitter:  EventEmitter2,
  ) {}

  /**
   * Processa todos os registros com status "Recebido".
   * RN-05: somente registros Recebido são elegíveis.
   * Retorna um resumo dos resultados.
   */
  async processarPendentes(): Promise<ResultadoProcessamento[]> {
    const pendentes = await this.prisma.obrigacaoAcessoria.findMany({
      where: { statusProcessamento: StatusProcessamento.RECEBIDO },
      orderBy: { dataRecebimentoEvento: 'asc' },
    });

    if (pendentes.length === 0) {
      this.logger.log('Nenhum registro Recebido para processar.');
      return [];
    }

    this.logger.log(`Processando ${pendentes.length} registro(s) com status Recebido.`);
    const resultados: ResultadoProcessamento[] = [];

    for (const obrigacao of pendentes) {
      const resultado = await this.processarUm(obrigacao);
      resultados.push(resultado);
    }

    const resumo = resultados.reduce<Record<string, number>>((acc, r) => {
      acc[r.statusFinal] = (acc[r.statusFinal] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(`Processamento concluído: ${JSON.stringify(resumo)}`);

    return resultados;
  }

  /**
   * Processa um único registro. Toda a lógica de versão é transacional.
   */
  async processarUm(obrigacao: {
    id: string;
    idEvento: string;
    cnpj: string;
    tipoObrigacao: string;
    dataInicial: Date;
    dataFinal: Date;
    finalidade: string;
    hash: string;
    caminhoBucket: string;
  }): Promise<ResultadoProcessamento> {
    const log = (msg: string) =>
      this.logger.log(`[${obrigacao.idEvento}][${obrigacao.cnpj}] ${msg}`);

    // RN-06: verificar existência do arquivo no GCS
    log(`Verificando GCS: ${obrigacao.caminhoBucket}`);
    let sha256Calculado: string;
    try {
      const info = await this.gcs.verificarArquivo(obrigacao.caminhoBucket);
      if (!info.exists) {
        log('Arquivo não encontrado no GCS → Erro_Arquivo_Nao_Encontrado');
        return this.registrarErro(obrigacao.id, obrigacao.idEvento, StatusProcessamento.ERRO_ARQUIVO_NAO_ENCONTRADO);
      }
      sha256Calculado = info.sha256!;
    } catch (err) {
      this.logger.error(`[${obrigacao.idEvento}] Falha ao acessar GCS: ${String(err)}`);
      return this.registrarErro(obrigacao.id, obrigacao.idEvento, StatusProcessamento.ERRO_ARQUIVO_NAO_ENCONTRADO);
    }

    // RN-07: verificar hash SHA-256
    if (sha256Calculado.toLowerCase() !== obrigacao.hash.toLowerCase()) {
      log(`Hash divergente: esperado=${obrigacao.hash} calculado=${sha256Calculado} → Erro_Hash_Divergente`);
      return this.registrarErro(obrigacao.id, obrigacao.idEvento, StatusProcessamento.ERRO_HASH_DIVERGENTE);
    }
    log('Hash OK.');

    // RN-09: lógica de versão — dentro de transação para evitar race condition
    const resultado = await this.aplicarVersaoEProcessar(obrigacao);

    // ECF processado com sucesso → dispara pipeline de análise de crédito
    if (resultado.statusFinal === StatusProcessamento.PROCESSADO &&
        obrigacao.tipoObrigacao === TipoObrigacao.ECF) {
      this.eventEmitter.emit('ecf.processado', { cnpj: obrigacao.cnpj });
    }

    return resultado;
  }

  /**
   * RN-09: gerencia versão/retificação dentro de uma transação Prisma.
   */
  private async aplicarVersaoEProcessar(obrigacao: {
    id: string;
    idEvento: string;
    cnpj: string;
    tipoObrigacao: string;
    dataInicial: Date;
    dataFinal: Date;
    finalidade: string;
    hash: string;
  }): Promise<ResultadoProcessamento> {
    const log = (msg: string) =>
      this.logger.log(`[${obrigacao.idEvento}][${obrigacao.cnpj}] ${msg}`);

    return this.prisma.$transaction(async (tx) => {
      // Busca o Processado mais recente para o mesmo CNPJ+Tipo+Período
      const processadoAtual = await tx.obrigacaoAcessoria.findFirst({
        where: {
          cnpj:                  obrigacao.cnpj,
          tipoObrigacao:         obrigacao.tipoObrigacao,
          dataInicial:           obrigacao.dataInicial,
          dataFinal:             obrigacao.dataFinal,
          statusProcessamento:   StatusProcessamento.PROCESSADO,
          versaoAtual:           true,
        },
        orderBy: { versao: 'desc' },
      });

      const finalidade = obrigacao.finalidade as FinalidadeObrigacao;

      // RN-09 — Original duplicado
      if (processadoAtual && finalidade === FinalidadeObrigacao.ORIGINAL) {
        log(`Original duplicado para ${obrigacao.tipoObrigacao} ${obrigacao.dataInicial.toISOString().slice(0, 10)} → Erro_Duplicata_Original`);
        await tx.obrigacaoAcessoria.update({
          where: { id: obrigacao.id },
          data: {
            statusProcessamento: StatusProcessamento.ERRO_DUPLICATA_ORIGINAL,
            atualizadoPor:       ATUALIZADO_POR,
          },
        });
        return {
          id:          obrigacao.id,
          idEvento:    obrigacao.idEvento,
          statusFinal: StatusProcessamento.ERRO_DUPLICATA_ORIGINAL,
        };
      }

      // RN-09 — Retificação: existe Processado + finalidade Retificacao
      if (processadoAtual && finalidade === FinalidadeObrigacao.RETIFICACAO) {
        const novaVersao = processadoAtual.versao + 1;
        const paiId      = processadoAtual.obrigacaoPaiId ?? processadoAtual.id;

        // Desativa o registro anterior
        await tx.obrigacaoAcessoria.update({
          where: { id: processadoAtual.id },
          data:  { versaoAtual: false, atualizadoPor: ATUALIZADO_POR },
        });

        // Atualiza o novo registro com versão, pai e status Processado
        await tx.obrigacaoAcessoria.update({
          where: { id: obrigacao.id },
          data: {
            statusProcessamento: StatusProcessamento.PROCESSADO,
            versao:              novaVersao,
            versaoAtual:         true,
            obrigacaoPaiId:      paiId,
            atualizadoPor:       ATUALIZADO_POR,
          },
        });

        log(`Retificação: versão ${novaVersao}, pai=${paiId} → Processado`);
        return {
          id:          obrigacao.id,
          idEvento:    obrigacao.idEvento,
          statusFinal: StatusProcessamento.PROCESSADO,
        };
      }

      // RN-09 — Novo registro original (versao=1)
      await tx.obrigacaoAcessoria.update({
        where: { id: obrigacao.id },
        data: {
          statusProcessamento: StatusProcessamento.PROCESSADO,
          versao:              1,
          versaoAtual:         true,
          obrigacaoPaiId:      null,
          atualizadoPor:       ATUALIZADO_POR,
        },
      });

      log(`Novo registro versão 1 → Processado`);
      return {
        id:          obrigacao.id,
        idEvento:    obrigacao.idEvento,
        statusFinal: StatusProcessamento.PROCESSADO,
      };
    });
  }

  private async registrarErro(
    id: string,
    idEvento: string,
    status: StatusProcessamento,
  ): Promise<ResultadoProcessamento> {
    await this.prisma.obrigacaoAcessoria.update({
      where: { id },
      data:  { statusProcessamento: status, atualizadoPor: ATUALIZADO_POR },
    });
    return { id, idEvento, statusFinal: status };
  }
}
