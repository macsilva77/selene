import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DfeDownloadService } from './dfe-download.service';
import { DfeManifestacaoService } from './dfe-manifestacao.service';

/**
 * Job agendado que executa o pipeline de download a cada 15 minutos:
 *  1. Envia Ciência (210200) para todos os RES_NFE pendentes (manifestacaoService.processarPendentes)
 *  2. Faz download dos XMLs completos (procNFe) via consChNFe (downloadService.processarPendentes)
 *
 * A Ciência precede o download porque a SEFAZ só disponibiliza o XML completo
 * após o destinatário manifestar ciência da operação (MOC 7.0 §5.8).
 */
@Injectable()
export class DfeDownloadJob {
  private readonly logger = new Logger(DfeDownloadJob.name);

  constructor(
    private readonly downloadService: DfeDownloadService,
    private readonly manifestacaoService: DfeManifestacaoService,
  ) {}

  @Cron('*/15 * * * *', { name: 'dfe-download-worker' })
  async executar(): Promise<void> {
    this.logger.debug('DFe Download Job: iniciando ciclo...');

    // Passo 1: envia Ciência da Operação para RES_NFE sem manifestação
    try {
      await this.manifestacaoService.processarPendentes();
    } catch (err) {
      this.logger.error(
        `DFe Download Job: falha ao processar Ciência — ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    // Passo 2: baixa XMLs completos (procNFe) para docs com Ciência enviada
    try {
      await this.downloadService.processarPendentes();
    } catch (err) {
      this.logger.error(
        `DFe Download Job: falha no download — ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
