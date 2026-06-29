import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CteEventoStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CteCertLoaderService } from './cte-cert-loader.service';
import { CteSoapClientService } from './cte-soap-client.service';
import { CtePubSubService } from './cte-pubsub.service';
import { CSTAT, TIPO_EVENTO_CTE, autorizadorDaUf } from './cte.types';

/** Código IBGE da UF → sigla (reverso de UF_PARA_CUF) */
const CUF_PARA_UF: Record<number, string> = {
  12: 'AC', 27: 'AL', 16: 'AP', 13: 'AM', 29: 'BA', 23: 'CE',
  53: 'DF', 32: 'ES', 52: 'GO', 21: 'MA', 51: 'MT', 50: 'MS',
  31: 'MG', 15: 'PA', 25: 'PB', 41: 'PR', 26: 'PE', 22: 'PI',
  33: 'RJ', 24: 'RN', 43: 'RS', 11: 'RO', 14: 'RR', 42: 'SC',
  35: 'SP', 28: 'SE', 17: 'TO',
};

/**
 * Eventos do tomador do CT-e — atualmente a Prestação do Serviço em Desacordo
 * (610110). O autor é o tomador (CNPJ monitorado); o evento é assinado e enviado
 * ao CTeRecepcaoEventoV4 da UF autorizadora do CT-e (derivada da chave de acesso).
 */
@Injectable()
export class CteEventoService {
  private readonly logger = new Logger(CteEventoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: CteCertLoaderService,
    private readonly soapClient: CteSoapClientService,
    private readonly pubSub: CtePubSubService,
  ) {}

  /**
   * Registra e envia uma Prestação de Serviço em Desacordo (610110) para o CT-e.
   * @param xObs observação obrigatória (15 a 255 caracteres)
   */
  async registrarDesacordo(tenantId: string, documentoId: string, xObs: string) {
    const def = TIPO_EVENTO_CTE.DESACORDO;

    const obs = (xObs ?? '').trim();
    if (obs.length < (def.xObsMinLength ?? 15) || obs.length > (def.xObsMaxLength ?? 255)) {
      throw new BadRequestException(
        `A observação do desacordo deve ter entre ${def.xObsMinLength} e ${def.xObsMaxLength} caracteres.`,
      );
    }

    const doc = await this.prisma.cteDocumento.findFirst({
      where: { id: documentoId, tenantId },
      select: { id: true, chaveAcesso: true, cnpjInteressado: true, cteTomadorCnpj: true },
    });
    if (!doc) throw new NotFoundException(`Documento CT-e ${documentoId} não encontrado.`);
    if (!doc.chaveAcesso || doc.chaveAcesso.length !== 44) {
      throw new BadRequestException('Documento sem chave de acesso válida — não é possível registrar desacordo.');
    }

    // O autor do desacordo DEVE ser o TOMADOR do serviço (a SEFAZ valida o autor
    // pelo CNPJ-base do certificado). Resolvemos a config/cert pelo tomador, não
    // pelo cnpjInteressado (que pode ser remetente/destinatário/expedidor/recebedor).
    if (!doc.cteTomadorCnpj) {
      throw new BadRequestException(
        'Documento sem tomador identificado — somente o tomador pode registrar Prestação de Serviço em Desacordo.',
      );
    }
    const config = await this.prisma.cteConfig.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj: doc.cteTomadorCnpj } },
      select: { id: true, cnpj: true, tpAmb: true },
    });
    if (!config) {
      throw new BadRequestException(
        `Só o tomador (${doc.cteTomadorCnpj}) pode registrar o desacordo, e não há configuração CT-e (certificado) para esse CNPJ neste tenant.`,
      );
    }

    const chCTe = doc.chaveAcesso;
    const cUFEmit = Number.parseInt(chCTe.slice(0, 2), 10);
    const ufAutorizador = CUF_PARA_UF[cUFEmit] ?? autorizadorDaUf(String(cUFEmit));
    const nSeqEvento = 1;

    // Idempotência: se já existe e foi ENVIADO, retorna o existente.
    const existente = await this.prisma.cteEvento.findUnique({
      where: {
        tenantId_chaveAcesso_tpEvento_nSeqEvento: {
          tenantId,
          chaveAcesso: chCTe,
          tpEvento: def.codigo,
          nSeqEvento,
        },
      },
    });
    if (existente && existente.status === CteEventoStatus.ENVIADO) {
      return existente;
    }

    // Cria ou reaproveita o registro (PENDENTE)
    const evento = existente
      ? await this.prisma.cteEvento.update({
          where: { id: existente.id },
          data: { xObs: obs, status: CteEventoStatus.PENDENTE, erroMensagem: null, tentativas: { increment: 1 } },
        })
      : await this.prisma.cteEvento.create({
          data: {
            tenantId,
            cnpj: config.cnpj,
            documentoId: doc.id,
            chaveAcesso: chCTe,
            tpEvento: def.codigo,
            xEvento: def.xEvento,
            nSeqEvento,
            xObs: obs,
            indDesacordo: true,
            ufAutorizador,
            status: CteEventoStatus.PENDENTE,
          },
        });

    try {
      const { pemCert, pemKey } = await this.certLoader.loadCert(tenantId, config.id);

      const ret = await this.soapClient.enviarEvento(
        {
          cnpj: config.cnpj,
          cUf: cUFEmit,
          tpAmb: config.tpAmb as 1 | 2,
          chCTe,
          tpEvento: def.codigo,
          xEvento: def.xEvento,
          descEvento: def.descEvento,
          nSeqEvento,
          xObs: obs,
          dhEvento: this.dhEvento(),
          idLote: Date.now().toString(),
          ufAutorizador,
        },
        pemCert,
        pemKey,
      );

      const item = ret.retEvento[0];
      const cStat = item?.cStat ?? ret.cStat;
      const sucesso =
        cStat === CSTAT.EVENTO_REGISTRADO ||
        cStat === CSTAT.EVENTO_VINCULADO ||
        cStat === CSTAT.DUPLICIDADE_EVENTO;

      const atualizado = await this.prisma.cteEvento.update({
        where: { id: evento.id },
        data: {
          status: sucesso ? CteEventoStatus.ENVIADO : CteEventoStatus.REJEITADO,
          cStat,
          xMotivo: item?.xMotivo ?? ret.xMotivo,
          nProt: item?.nProt,
          dhRegEvento: item?.dhRegEvento ? new Date(item.dhRegEvento) : null,
          enviadoEm: sucesso ? new Date() : null,
        },
      });

      if (sucesso) {
        await this.pubSub.publicarEventoEnviado({
          tenantId,
          cnpj: config.cnpj,
          documentoId: doc.id,
          chaveAcesso: chCTe,
          tpEvento: def.codigo,
        });
        this.logger.log(`Desacordo registrado: chCTe=...${chCTe.slice(-4)} cStat=${cStat} nProt=${item?.nProt ?? '-'}`);
      } else {
        this.logger.warn(`Desacordo rejeitado: chCTe=...${chCTe.slice(-4)} cStat=${cStat} "${item?.xMotivo ?? ret.xMotivo}"`);
      }

      return atualizado;
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Falha ao enviar desacordo (chCTe=...${chCTe.slice(-4)}): ${msg}`);
      return this.prisma.cteEvento.update({
        where: { id: evento.id },
        data: { status: CteEventoStatus.ERRO, erroMensagem: msg },
      });
    }
  }

  /** Formata a data/hora do evento no padrão SEFAZ com offset -03:00 (Brasília). */
  private dhEvento(): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    // Desloca o instante atual em -3h e formata com getters UTC → wall-clock de Brasília.
    const b = new Date(Date.now() - 3 * 3600_000);
    return (
      `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}` +
      `T${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}:${pad(b.getUTCSeconds())}-03:00`
    );
  }
}
