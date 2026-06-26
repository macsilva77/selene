import { Module } from '@nestjs/common';
import { NfseDistribuicaoModule } from './nfse-distribuicao.module';
import { NfseDistribuicaoJob } from './nfse-distribuicao.job';

/**
 * Módulo do agendador de recepção NFS-e — importado SOMENTE pelo processo Worker
 * (selene-worker, min-instances=1 / CPU always-on, sempre vivo). Roda o @Cron
 * de forma confiável sem depender de tráfego, espelhando o DfeDistribuicaoWorkerModule.
 *
 * O endpoint /nfse/cron/executar + Cloud Scheduler permanecem como redundância.
 */
@Module({
  imports: [NfseDistribuicaoModule],
  providers: [NfseDistribuicaoJob],
})
export class NfseDistribuicaoWorkerModule {}
