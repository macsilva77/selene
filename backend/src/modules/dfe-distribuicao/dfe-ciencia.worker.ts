import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { DfeManifestacaoStatus } from '@prisma/client';
import { DfeManifestacaoService } from './dfe-manifestacao.service';
import { DfePubSubService } from './dfe-pubsub.service';
import { DFE_CIENCIA_QUEUE, DfeCienciaJobData } from './dfe-queue.constants';

/**
 * Worker do job dfe:ciencia — por documento RES_NFE.
 *
 * Responsabilidades:
 *  1. Envia a Ciência da Operação (tpEvento=210210) para o documento.
 *  2. Se enviada com sucesso, emite evento Pub/Sub.
 *
 * O PROC_NFE é obtido automaticamente pelo scan sequencial distNSU
 * (DfeResumoWorker) nos ciclos seguintes — sem consChNFe individual.
 */
@Processor(DFE_CIENCIA_QUEUE)
export class DfeCienciaWorker {
  private readonly logger = new Logger(DfeCienciaWorker.name);

  constructor(
    private readonly manifestacaoService: DfeManifestacaoService,
    private readonly pubSub: DfePubSubService,
  ) {}

  @Process({ concurrency: 3 })
  async handle(job: Job<DfeCienciaJobData>): Promise<void> {
    const { tenantId, cnpj, documentoId, chaveAcesso } = job.data;

    this.logger.debug(`[ciencia] documentoId=${documentoId} chave=...${chaveAcesso.slice(-6)}`);

    const manifestacao = await this.manifestacaoService.registrarEEnviar(
      tenantId,
      { documentoId, tpEvento: '210210' },
    );

    const enviada = manifestacao.status === DfeManifestacaoStatus.ENVIADO;

    if (!enviada) {
      this.logger.warn(
        `[ciencia] status=${manifestacao.status} para doc=${documentoId} — será retentado`,
      );
      throw new Error(`Ciência retornou status=${manifestacao.status} (cStat=${manifestacao.cStat ?? '?'})`);
    }

    this.logger.debug(`[ciencia] enviada com sucesso — doc=${documentoId}`);

    await this.pubSub.publicarCienciaEnviada({ tenantId, cnpj, documentoId, chaveAcesso });
  }
}
