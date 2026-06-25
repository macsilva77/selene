import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NfseDistribuicaoService } from './nfse-distribuicao.service';
import { ConfigurarNfseDto } from './dto/configurar-nfse.dto';
import { AssociarDocumentosDto } from '../etiquetas/dto/associar-documentos.dto';

class ListarDocumentosQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() papel?: string;
  @IsOptional() @IsString() prestadorDoc?: string;
  @IsOptional() @IsString() tomadorDoc?: string;
  @IsOptional() @IsString() chaveAcesso?: string;
  @IsOptional() @IsString() competenciaInicio?: string;
  @IsOptional() @IsString() competenciaFim?: string;
  @IsOptional() @IsString() cancelada?: string;
  @IsOptional() @IsString() municipio?: string;
}

@ApiTags('NFS-e Distribuição')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('nfse')
export class NfseDistribuicaoController {
  constructor(private readonly service: NfseDistribuicaoService) {}

  /** POST /nfse/configurar — cria/atualiza a recepção de um CNPJ. */
  @Post('configurar')
  @RequiresPermission('nfse.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Configurar recepção NFS-e para um CNPJ' })
  configurar(
    @Body() dto: ConfigurarNfseDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.service.configurar(tenantId, usuarioId, dto);
  }

  /** GET /nfse/status — configs do tenant + estatísticas de NSU. */
  @Get('status')
  @RequiresPermission('nfse.view')
  @ApiOperation({ summary: 'Status das configurações NFS-e do tenant' })
  status(@CurrentUser('tenantId') tenantId: string) {
    return this.service.listarStatus(tenantId);
  }

  /** PATCH /nfse/configurar/:id/ativo — ativa/desativa uma configuração. */
  @Patch('configurar/:id/ativo')
  @RequiresPermission('nfse.manage')
  @ApiOperation({ summary: 'Ativar/desativar configuração NFS-e' })
  definirAtivo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('ativo') ativo: boolean,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.definirAtivo(tenantId, id, ativo);
  }

  /** POST /nfse/sincronizar/:configId — dispara um ciclo de recepção manual. */
  @Post('sincronizar/:configId')
  @RequiresPermission('nfse.manage')
  @ApiOperation({ summary: 'Disparar ciclo de recepção NFS-e manualmente' })
  sincronizar(@Param('configId', ParseUUIDPipe) configId: string) {
    return this.service.executarCiclo(configId);
  }

  /** GET /nfse/documentos — lista NFS-e recebidas (paginado/filtrado). */
  @Get('documentos')
  @RequiresPermission('nfse.view')
  @ApiOperation({ summary: 'Listar NFS-e recebidas' })
  listarDocumentos(
    @Query() q: ListarDocumentosQuery,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.listarDocumentos(tenantId, {
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      cnpj: q.cnpj,
      papel: q.papel,
      prestadorDoc: q.prestadorDoc,
      tomadorDoc: q.tomadorDoc,
      chaveAcesso: q.chaveAcesso,
      competenciaInicio: q.competenciaInicio,
      competenciaFim: q.competenciaFim,
      cancelada: q.cancelada === undefined ? undefined : q.cancelada === 'true',
      municipio: q.municipio,
    });
  }

  /** GET /nfse/municipios — municípios de incidência atendidos (com contagem). */
  @Get('municipios')
  @RequiresPermission('nfse.view')
  @ApiOperation({ summary: 'Municípios atendidos nas NFS-e recebidas' })
  municipios(@CurrentUser('tenantId') tenantId: string) {
    return this.service.listarMunicipios(tenantId);
  }

  /** GET /nfse/documentos/:id — detalhe da NFS-e (com XML e eventos). */
  @Get('documentos/:id')
  @RequiresPermission('nfse.view')
  @ApiOperation({ summary: 'Detalhe de uma NFS-e recebida' })
  obterDocumento(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.obterDocumento(tenantId, id);
  }

  /** POST /nfse/documentos/etiquetas — associa/desassocia etiquetas a NFS-e. */
  @Post('documentos/etiquetas')
  @RequiresPermission('etiquetas.edit')
  @ApiOperation({ summary: 'Associar/desassociar etiquetas a NFS-e' })
  associarEtiquetas(
    @Body() dto: AssociarDocumentosDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.service.associarEtiquetas(tenantId, usuarioId, dto);
  }

  /** GET /nfse/documentos/:id/etiqueta-historico — histórico de etiquetas. */
  @Get('documentos/:id/etiqueta-historico')
  @RequiresPermission('nfse.view')
  @ApiOperation({ summary: 'Histórico de etiquetas de uma NFS-e' })
  etiquetaHistorico(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.listarEtiquetaHistorico(tenantId, id);
  }

  /** GET /nfse/documentos/:id/danfse — baixa o PDF do DANFSe (proxy do ADN). */
  @Get('documentos/:id/danfse')
  @RequiresPermission('nfse.view')
  @ApiOperation({ summary: 'Baixar DANFSe (PDF) de uma NFS-e recebida' })
  async danfse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('tenantId') tenantId: string,
    @Res() res: Response,
  ) {
    const { pdf, nomeArquivo } = await this.service.baixarDanfse(tenantId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      'Content-Length': String(pdf.length),
    });
    res.send(pdf);
  }
}
