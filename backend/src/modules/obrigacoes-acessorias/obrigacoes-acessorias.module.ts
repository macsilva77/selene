import { Module } from '@nestjs/common';
import { ObrigacoesAcessoriasService } from './obrigacoes-acessorias.service';
import { ObrigacoesAcessoriasController } from './obrigacoes-acessorias.controller';
import { ObrigacoesAcessoriasPubSubConsumer } from './obrigacoes-acessorias-pubsub.consumer';
import { GcsService } from './gcs.service';
import { ObrigacaoProcessamentoService } from './obrigacao-processamento.service';
import { ObrigacaoProcessamentoJob } from './obrigacao-processamento.job';

@Module({
  controllers: [ObrigacoesAcessoriasController],
  providers: [
    ObrigacoesAcessoriasService,
    ObrigacoesAcessoriasPubSubConsumer,
    GcsService,
    ObrigacaoProcessamentoService,
    ObrigacaoProcessamentoJob,
  ],
  exports: [ObrigacoesAcessoriasService, ObrigacaoProcessamentoService],
})
export class ObrigacoesAcessoriasModule {}
