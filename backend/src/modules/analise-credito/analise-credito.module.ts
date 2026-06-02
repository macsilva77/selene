import { Module }                    from '@nestjs/common';
import { PrismaModule }              from '../../database/prisma.module';
import { P01GcsService }             from './p01/p01-gcs.service';
import { P01Service }                from './p01/p01.service';
import { P01Job }                    from './p01/p01.job';
import { P02BalancoService }         from './p02/p02-balanco.service';
import { P02DreService }             from './p02/p02-dre.service';
import { P02Service }                from './p02/p02.service';
import { P03Service }                from './p03/p03.service';
import { P04Service }                from './p04/p04.service';
import { AnaliseCreditoController }  from './analise-credito.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [AnaliseCreditoController],
  providers:   [P01GcsService, P01Service, P01Job, P02BalancoService, P02DreService, P02Service, P03Service, P04Service],
  exports:     [P01Service, P02Service, P03Service, P04Service],
})
export class AnaliseCreditoModule {}
