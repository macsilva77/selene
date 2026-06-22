import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CertificadoConvitesService } from './certificado-convites.service';
import { CriarConviteDto } from './dto/criar-convite.dto';

@ApiTags('Certificados — Convites de Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('certificados/convites')
export class CertificadoConvitesController {
  constructor(private readonly service: CertificadoConvitesService) {}

  @Post()
  @RequiresPermission('certificados.create')
  @ApiOperation({ summary: 'Gerar link de onboarding e enviar por e-mail ao cliente' })
  criar(
    @Body() dto: CriarConviteDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.service.criar(dto, tenantId, usuarioId);
  }

  @Get()
  @RequiresPermission('certificados.view')
  @ApiOperation({ summary: 'Listar convites de onboarding e seus status' })
  listar(@CurrentUser('tenantId') tenantId: string) {
    return this.service.listar(tenantId);
  }

  @Patch(':id/revogar')
  @RequiresPermission('certificados.delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revogar um convite de onboarding ainda não utilizado' })
  revogar(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.service.revogar(id, tenantId);
  }
}
