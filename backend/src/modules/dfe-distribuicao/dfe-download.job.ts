import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DfeManifestacaoService } from './dfe-manifestacao.service';

/**
 * Fallback de Ciência — garante que RES_NFE sem manifestação eventualmente
 * recebam Ciência (210210), mesmo que o job Bull dfe:ciencia tenha sido perdido.
 *
 * O PROC_NFE é obtido pelo scan sequencial distNSU (DfeResumoWorker) — sem
 * consChNFe individual. Não há passo de download aqui.
 */
@Injectable()
export class DfeDownloadJob {
  private readonly logger = new Logger(DfeDownloadJob.name);

  constructor(
    private readonly manifestacaoService: DfeManifestacaoService,
  ) {}

  @Cron('*/15 * * * *', { name: 'dfe-ciencia-fallback' })
  async executar(): Promise<void> {
    this.logger.debug('DFe Ciência fallback: verificando pendentes...');
    try {
      await this.manifestacaoService.processarPendentes();
    } catch (err) {
      this.logger.error(
        `DFe Ciência fallback: falha — ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
