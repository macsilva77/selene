import { Module } from '@nestjs/common';
import { SimplesNacionalService } from './simples-nacional.service';
import { PgdasCrawlerService } from './pgdas-crawler.service';
import { SimplesNacionalController } from './simples-nacional.controller';
import { CertificadosModule } from '../certificados/certificados.module';

@Module({
  imports: [CertificadosModule],
  providers: [SimplesNacionalService, PgdasCrawlerService],
  controllers: [SimplesNacionalController],
  exports: [SimplesNacionalService],
})
export class SimplesNacionalModule {}
