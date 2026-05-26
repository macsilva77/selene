import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard';
import { CertificadosService } from './certificados.service';

@ApiExcludeController()
@UseGuards(InternalTokenGuard)
@Controller('internal/certificados')
export class InternalCertificadosController {
  constructor(private readonly service: CertificadosService) {}

  @Get('pfx/:cnpj')
  exportarPfx(@Param('cnpj') cnpj: string) {
    return this.service.exportarPfxInterno(cnpj);
  }
}
