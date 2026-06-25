import { Module } from '@nestjs/common';
import { NfseXmlProcessorService } from './nfse-xml-processor.service';
import { NfseDistClientService } from './nfse-dist-client.service';
import { NfseCertLoaderService } from './nfse-cert-loader.service';
import { NfseNsuControlRepository } from './nfse-nsu-control.repository';
import { NfseDistribuicaoService } from './nfse-distribuicao.service';
import { NfseDistribuicaoController } from './nfse-distribuicao.controller';
import { NfseDistribuicaoJob } from './nfse-distribuicao.job';

/**
 * Módulo de Recepção/Distribuição de NFS-e (modelo Nacional — SNNFS-e / ADN).
 *
 * Camadas:
 *  - conteúdo:    NfseXmlProcessorService (parser TCNFSe + eventos, persistência);
 *  - transporte:  NfseDistClientService (REST mTLS, GET /DFe/{NSU});
 *  - orquestração: NfseDistribuicaoService (ciclo NSU + lock) + repos/cert loader;
 *  - agendamento: NfseDistribuicaoJob (@Cron a cada 5 min, lock distribuído);
 *  - API:         NfseDistribuicaoController (config + sincronização + consulta).
 */
@Module({
  controllers: [NfseDistribuicaoController],
  providers: [
    NfseXmlProcessorService,
    NfseDistClientService,
    NfseCertLoaderService,
    NfseNsuControlRepository,
    NfseDistribuicaoService,
    NfseDistribuicaoJob,
  ],
  exports: [
    NfseXmlProcessorService,
    NfseDistClientService,
    NfseDistribuicaoService,
  ],
})
export class NfseDistribuicaoModule {}
