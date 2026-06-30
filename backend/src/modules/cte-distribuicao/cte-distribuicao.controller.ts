import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CteDistribuicaoService } from './cte-distribuicao.service';
import { CteEventoService } from './cte-evento.service';
import { ConfigurarCteDto } from './dto/configurar-cte.dto';
import { RegistrarDesacordoDto } from './dto/registrar-desacordo.dto';

class CteDocumentosQueryDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() tipo?: string;
  @IsOptional() @IsString() modelo?: string;
  @IsOptional() @IsString() chaveAcesso?: string;
  @IsOptional() @IsString() cteEmitenteCnpj?: string;
  @IsOptional() @IsString() cteTomadorCnpj?: string;
  @IsOptional() @IsString() cteRemetenteCnpj?: string;
  @IsOptional() @IsString() cteDestinatarioCnpj?: string;
  @IsOptional() @IsString() cteRecebedorCnpj?: string;
  @IsOptional() @IsString() cteExpedidorCnpj?: string;
  @IsOptional() @IsString() dataInicio?: string;
  @IsOptional() @IsString() dataFim?: string;
  @IsOptional() @IsString() valorMin?: string;
  @IsOptional() @IsString() valorMax?: string;
}

@ApiTags('CT-e Distribuição')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cte')
export class CteDistribuicaoController {
  constructor(
    private readonly service: CteDistribuicaoService,
    private readonly eventoService: CteEventoService,
  ) {}

  @Post('configurar')
  @RequiresPermission('cte.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Configurar monitoramento de CT-e para um CNPJ' })
  configurar(
    @Body() dto: ConfigurarCteDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.service.configurarCte(tenantId, usuarioId, dto);
  }

  @Get('status')
  @RequiresPermission('cte.view')
  @ApiOperation({ summary: 'Status de todas as configurações CT-e do tenant' })
  status(@CurrentUser('tenantId') tenantId: string) {
    return this.service.listarStatus(tenantId);
  }

  @Get('lotes')
  @RequiresPermission('cte.view')
  @ApiOperation({ summary: 'Histórico de lotes (chamadas SEFAZ) por configuração' })
  lotes(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: { configId?: string; cnpj?: string; page?: string; limit?: string },
  ) {
    return this.service.listarLotes(tenantId, {
      configId: query.configId,
      cnpj: query.cnpj,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Post(':configId/toggle')
  @RequiresPermission('cte.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ativar/desativar monitoramento CT-e' })
  toggle(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.toggleConfig(tenantId, configId);
  }

  @Delete(':configId')
  @RequiresPermission('cte.manage')
  @ApiOperation({ summary: 'Excluir configuração CT-e e dados relacionados' })
  excluir(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.excluirConfig(tenantId, configId);
  }

  @Post('sincronizar/:configId')
  @RequiresPermission('cte.manage')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Disparar sincronização manual (ignora cooldown)' })
  sincronizar(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.dispararSincronizacao(tenantId, configId);
  }

  @Get('documentos')
  @RequiresPermission('cte.view')
  @ApiOperation({ summary: 'Listar documentos CT-e com filtros' })
  documentos(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: CteDocumentosQueryDto,
  ) {
    return this.service.listarDocumentos(tenantId, query);
  }

  @Get('documentos/:documentoId/eventos')
  @RequiresPermission('cte.view')
  @ApiOperation({ summary: 'Listar eventos de um documento CT-e' })
  eventos(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.listarEventos(tenantId, documentoId);
  }

  @Post('documentos/backfill-participantes')
  @RequiresPermission('cte.manage')
  @ApiOperation({ summary: 'Reprocessa XMLs para popular os nomes dos participantes (docs antigos)' })
  backfillParticipantes(@CurrentUser('tenantId') tenantId: string) {
    return this.service.backfillParticipantes(tenantId);
  }

  @Post('documentos/:documentoId/desacordo')
  @RequiresPermission('cte.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar Prestação de Serviço em Desacordo (610110)' })
  desacordo(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Body() dto: RegistrarDesacordoDto,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.eventoService.registrarDesacordo(tenantId, documentoId, dto.xObs);
  }
}
