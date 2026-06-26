import { Module } from '@nestjs/common';
import { NfseXmlProcessorService } from './nfse-xml-processor.service';
import { NfseDistClientService } from './nfse-dist-client.service';
import { NfseCertLoaderService } from './nfse-cert-loader.service';
import { NfseNsuControlRepository } from './nfse-nsu-control.repository';
import { NfseDistribuicaoService } from './nfse-distribuicao.service';
import { NfseDistribuicaoController } from './nfse-distribuicao.controller';

/**
 * Módulo de serviços NFS-e — usado pela API e (via re-import) pelo Worker.
 *
 * Contém os serviços e o controller. O agendador (@Cron) NÃO fica aqui:
 * ele vive em NfseDistribuicaoWorkerModule, importado exclusivamente pelo
 * processo Worker (selene-worker, sempre vivo), espelhando o padrão do DFe.
 */
@Module({
  controllers: [NfseDistribuicaoController],
  providers: [
    NfseXmlProcessorService,
    NfseDistClientService,
    NfseCertLoaderService,
    NfseNsuControlRepository,
    NfseDistribuicaoService,
  ],
  exports: [
    NfseXmlProcessorService,
    NfseDistClientService,
    NfseDistribuicaoService,
    NfseNsuControlRepository,
  ],
})
export class NfseDistribuicaoModule {}
