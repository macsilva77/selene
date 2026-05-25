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
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

class IniciarVarreduraDto {
  /** NSU inicial (máx 15 dígitos). Ex.: "000001000000000" */
  @IsString()
  @Matches(/^\d{1,15}$/, { message: 'nsuInicio deve conter apenas dígitos (até 15).' })
  nsuInicio: string;

  /** NSU final (máx 15 dígitos). Ex.: "000002000000000" */
  @IsString()
  @Matches(/^\d{1,15}$/, { message: 'nsuFim deve conter apenas dígitos (até 15).' })
  nsuFim: string;
}
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DfeDistribuicaoService } from './dfe-distribuicao.service';
import { DfeManifestacaoService } from './dfe-manifestacao.service';
import { DfeDownloadService } from './dfe-download.service';
import { DfeMetricsService } from './dfe-metrics.service';
import { DfeXmlProcessorService } from './dfe-xml-processor.service';
import { DfeDanfeService } from './dfe-danfe.service';
import { DfeVarreduraService } from './dfe-varredura.service';
import { ConfigurarDfeDto } from './dto/configurar-dfe.dto';
import { ManifestarDfeDto } from './dto/manifestar-dfe.dto';
import { ExportarDanfeDto } from './dto/exportar-danfe.dto';

class DocumentosQueryDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() cnpjEmitente?: string;
  @IsOptional() @IsString() cnpjTransportador?: string;
  @IsOptional() @IsString() cnpjAutXml?: string;
  @IsOptional() @IsString() tipo?: string;
  @IsOptional() @IsString() dataInicio?: string;
  @IsOptional() @IsString() dataFim?: string;
  @IsOptional() @IsString() chaveAcesso?: string;
  @IsOptional() @IsString() valorMin?: string;
  @IsOptional() @IsString() valorMax?: string;
  @IsOptional() @IsString() configId?: string;
  @IsOptional() @IsString() raizCnpj?: string;
  @IsOptional() @IsString() nNF?: string;
  /** IDs de etiquetas separados por vírgula (OR lógico) */
  @IsOptional() @IsString() etiquetaIds?: string;
  /** Aba Recebidas: exclui docs onde o CNPJ monitorado aparece como emitente/transportador/autXML */
  @IsOptional() @IsString() excluirOutrosPapeis?: string;
}

@ApiTags('DF-e Distribuição')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dfe')
export class DfeDistribuicaoController {
  constructor(
    private readonly service: DfeDistribuicaoService,
    private readonly manifestacaoService: DfeManifestacaoService,
    private readonly downloadService: DfeDownloadService,
    private readonly metricsService: DfeMetricsService,
    private readonly xmlProcessor: DfeXmlProcessorService,
    private readonly danfeService: DfeDanfeService,
    private readonly varreduraService: DfeVarreduraService,
  ) {}

  /**
   * POST /dfe/configurar
   *
   * Cria uma nova configuração de monitoramento DF-e para um CNPJ.
   * A senha do PFX é validada e armazenada criptografada.
   */
  @Post('configurar')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Configurar monitoramento DF-e para um CNPJ' })
  configurar(
    @Body() dto: ConfigurarDfeDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.service.configurarDfe(tenantId, usuarioId, dto);
  }

  /**
   * GET /dfe/status
   *
   * Retorna todas as configurações DF-e do tenant com estatísticas de NSU.
   */
  @Get('status')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Status de todas as configurações DF-e do tenant' })
  status(@CurrentUser('tenantId') tenantId: string) {
    return this.service.getStatus(tenantId);
  }

  /**
   * GET /dfe/metricas
   *
   * Retorna métricas operacionais agregadas do módulo DFe para o tenant:
   * contagem de documentos por tipo, manifestações por status, gaps NSU,
   * desempenho de lotes (última 24h) e erros de auditoria.
   */
  @Get('metricas')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Métricas operacionais do módulo DFe' })
  metricas(@CurrentUser('tenantId') tenantId: string) {
    return this.metricsService.getMetricas(tenantId);
  }

  /**
   * PATCH /dfe/:configId/toggle
   *
   * Ativa ou desativa um monitoramento DFe (liga/desliga).
   */
  @Post(':configId/toggle')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ativar/desativar monitoramento DFe' })
  toggle(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.toggleAtivo(tenantId, configId);
  }

  /**
   * DELETE /dfe/:configId
   *
   * Exclui permanentemente uma configuração DFe e todos os dados relacionados
   * (lotes, documentos, manifestações, varredura, controle NSU).
   */
  @Delete(':configId')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Excluir permanentemente uma configuração DFe' })
  excluir(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.excluirConfig(tenantId, configId);
  }

  /**
   * POST /dfe/sincronizar/:configId
   *
   * Dispara manualmente um ciclo de distribuição para a configuração informada.
   * Útil para testes e reprocessamento manual.
   */
  @Post('sincronizar/:configId')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Disparar sincronização manual de DF-e' })
  async sincronizar(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    const config = await this.service.assertConfigBelongsToTenant(configId, tenantId);
    void this.service.sincronizarDfe(config.id, undefined, true).catch(() => {});
    return { message: 'Sincronização iniciada. Verifique /dfe/status para acompanhar.' };
  }

  /**
   * POST /dfe/reset-nsu/:configId
   *
   * Zera o NSU e libera o cooldown — o cron iniciará a recuperação dos 90 dias
   * na próxima execução sem aguardar o intervalo agendado.
   */
  @Post('reset-nsu/:configId')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Zerar NSU e recuperar os 90 dias permitidos pela SEFAZ' })
  async resetarNsu(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    await this.service.resetarNsu(tenantId, configId);
    void this.service.sincronizarDfe(configId, undefined, true).catch(() => {});
    return { message: 'NSU zerado. Recuperação dos 90 dias iniciada — acompanhe em /dfe/status.' };
  }

  /**
   * POST /dfe/:configId/baixar
   *
   * Aciona manualmente o pipeline de download de NF-e para a configuração informada:
   * primeiro envia a Ciência (210210) para todos os RES_NFE pendentes do CNPJ,
   * depois executa o `consChNFe` para baixar os XML completos (procNFe).
   * A execução ocorre em background — retorna 202 imediatamente.
   */
  @Post(':configId/baixar')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Baixar NF-e pendentes (Ciência + consChNFe) para uma configuração' })
  async baixar(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    const config = await this.service.assertConfigBelongsToTenant(configId, tenantId);
    void (async () => {
      await this.manifestacaoService.processarPendentes({ tenantId, cnpj: config.cnpj });
      await this.downloadService.processarPendentes({ tenantId, cnpj: config.cnpj });
    })().catch(() => {
      // Erros são logados internamente pelos services
    });
    return { message: 'Download iniciado. Verifique /dfe/documentos para acompanhar.' };
  }

  /**
   * GET /dfe/documentos
   *
   * Lista os documentos fiscais capturados, com paginação e filtros.
   */
  @Get('documentos')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Listar documentos fiscais eletrônicos capturados' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cnpj', required: false, type: String })
  @ApiQuery({ name: 'tipo', required: false, enum: ['PROC_NFE', 'PROC_EVENTO_NFE', 'RES_NFE', 'RES_EVENTO'] })
  @ApiQuery({ name: 'dataInicio', required: false, type: String, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dataFim', required: false, type: String, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'chaveAcesso', required: false, type: String })
  documentos(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: DocumentosQueryDto,
  ) {
    const { page, limit, cnpj, cnpjEmitente, cnpjTransportador, cnpjAutXml, tipo, dataInicio, dataFim, chaveAcesso, valorMin, valorMax, configId, raizCnpj, nNF, etiquetaIds, excluirOutrosPapeis } = query;
    return this.service.listarDocumentos(tenantId, {
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      cnpj,
      cnpjEmitente,
      cnpjTransportador,
      cnpjAutXml,
      tipo,
      dataInicio,
      dataFim,
      chaveAcesso,
      valorMin: valorMin ? Number.parseFloat(valorMin) : undefined,
      valorMax: valorMax ? Number.parseFloat(valorMax) : undefined,
      configId,
      raizCnpj: raizCnpj === 'true',
      nNF,
      etiquetaIds: etiquetaIds ? etiquetaIds.split(',').filter(Boolean) : undefined,
      excluirOutrosPapeis: excluirOutrosPapeis === 'true',
    });
  }

  /**
   * GET /dfe/documentos/exportar
   *
   * Exporta os documentos fiscais filtrados como arquivo CSV.
   * Aplica os mesmos filtros que GET /dfe/documentos (exceto paginação).
   * Coluna "Etiquetas" contém os nomes separados por vírgula; "-" quando vazio.
   */
  @Get('documentos/exportar')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Exportar documentos fiscais para CSV (aplica filtros ativos)' })
  async exportarDocumentos(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: DocumentosQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { cnpj, cnpjEmitente, cnpjTransportador, cnpjAutXml, tipo, dataInicio, dataFim, chaveAcesso, valorMin, valorMax, configId, raizCnpj, nNF, etiquetaIds, excluirOutrosPapeis } = query;
    const buffer = await this.service.exportarDocumentos(tenantId, {
      cnpj,
      cnpjEmitente,
      cnpjTransportador,
      cnpjAutXml,
      tipo,
      dataInicio,
      dataFim,
      chaveAcesso,
      valorMin: valorMin ? Number.parseFloat(valorMin) : undefined,
      valorMax: valorMax ? Number.parseFloat(valorMax) : undefined,
      configId,
      raizCnpj: raizCnpj === 'true',
      nNF,
      etiquetaIds: etiquetaIds ? etiquetaIds.split(',').filter(Boolean) : undefined,
      excluirOutrosPapeis: excluirOutrosPapeis === 'true',
    });
    const filename = `nf-es-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Manifestação do Destinatário
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * POST /dfe/manifestacao
   *
   * Registra e envia uma manifestação do destinatário para uma NF-e.
   * Tipos aceitos: 210200 (Confirmação), 210210 (Ciência), 210220 (Não realizada), 210240 (Desconhecimento).
   */
  @Post('manifestacao')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar e enviar manifestação do destinatário' })
  manifestar(
    @Body() dto: ManifestarDfeDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.manifestacaoService.registrarEEnviar(tenantId, dto, usuarioId);
  }

  /**
   * GET /dfe/manifestacoes
   *
   * Lista manifestações do destinatário do tenant com filtros e paginação.
   */
  @Get('manifestacoes')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Listar manifestações do destinatário' })
  @ApiQuery({ name: 'cnpj', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDENTE', 'ENVIADO', 'REJEITADO', 'ERRO'] })
  @ApiQuery({ name: 'documentoId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  manifestacoes(
    @CurrentUser('tenantId') tenantId: string,
    @Query('cnpj') cnpj?: string,
    @Query('status') status?: string,
    @Query('documentoId') documentoId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.manifestacaoService.listar(tenantId, {
      cnpj,
      status,
      documentoId,
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Manifestar por ID de documento (atalho path-based)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * POST /dfe/documentos/:documentoId/manifestar
   *
   * Registra e envia uma manifestação para o documento informado.
   * O `documentoId` vem no path; `tpEvento` e `xJust` (opcional) no body.
   */
  @Post('documentos/:documentoId/manifestar')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Manifestar documento específico (tpEvento no body)' })
  manifestarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Body() body: Omit<ManifestarDfeDto, 'documentoId'>,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.manifestacaoService.registrarEEnviar(tenantId, { ...body, documentoId }, usuarioId);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DANFE — PDF e exportação em lote
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * GET /dfe/documentos/:documentoId/danfe
   *
   * Gera e faz o download do DANFE (PDF) do documento procNFe.
   * Disponível apenas para documentos do tipo PROC_NFE.
   */
  @Get('documentos/:documentoId/danfe')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Download do DANFE (PDF) do documento fiscal' })
  async downloadDanfe(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const pdf = await this.danfeService.gerarDanfePdf(documentoId, tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="danfe-${documentoId}.pdf"`);
    return new StreamableFile(pdf);
  }

  /**
   * POST /dfe/documentos/exportar-danfe
   *
   * Enfileira a geração em lote de DANFEs (ZIP).
   * Opcionalmente envia o ZIP por e-mail quando o job conclui.
   * Retorna imediatamente com o jobId para acompanhamento.
   */
  @Post('documentos/exportar-danfe')
  @RequiresPermission('dfe.view')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Exportar múltiplos DANFEs como ZIP (assíncrono)' })
  exportarDanfe(
    @Body() dto: ExportarDanfeDto,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.danfeService.enfileirarExportacao(tenantId, dto.documentoIds, dto.email);
  }

  /**
   * GET /dfe/exportacoes/:jobId
   *
   * Retorna o status de um job de exportação de DANFEs.
   */
  @Get('exportacoes/:jobId')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Status de job de exportação de DANFEs' })
  statusExportacao(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.danfeService.statusExportacao(jobId, tenantId);
  }

  /**
   * GET /dfe/exportacoes/:jobId/download
   *
   * Faz o download do ZIP gerado por um job de exportação concluído.
   */
  @Get('exportacoes/:jobId/download')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Download do ZIP de DANFEs exportados' })
  async downloadExportacao(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const zipPath = await this.danfeService.caminhoZip(jobId, tenantId);
    const { createReadStream, statSync } = await import('node:fs');
    const stat = statSync(zipPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="danfe-${jobId}.zip"`);
    res.setHeader('Content-Length', stat.size);
    return new StreamableFile(createReadStream(zipPath));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Download de XML
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * GET /dfe/documentos/:documentoId/xml
   *
   * Faz o download do XML bruto (bytes) do documento DFe armazenado.
   * Content-Type: application/xml; charset=utf-8
   * Content-Disposition: attachment; filename="<chaveAcesso>.xml"
   */
  @Get('documentos/:documentoId/xml')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Download do XML do documento fiscal' })
  async downloadXml(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const doc = await this.service.obterXmlDocumento(tenantId, documentoId);
    const filename = `${doc.chaveAcesso ?? documentoId}.xml`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(doc.xmlBuffer);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Gaps NSU
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * GET /dfe/lotes
   *
   * Lista lotes de requisição SEFAZ do tenant (histórico de operações).
   * Filtros: configId, cnpj, page, limit.
   */
  @Get('lotes')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Histórico de lotes SEFAZ' })
  @ApiQuery({ name: 'configId', required: false })
  @ApiQuery({ name: 'cnpj', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listarLotes(
    @CurrentUser('tenantId') tenantId: string,
    @Query('configId') configId?: string,
    @Query('cnpj') cnpj?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listarLotes(tenantId, {
      configId,
      cnpj,
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  /**
   * GET /dfe/gaps
   *
   * Lista gaps NSU detectados para o tenant, com paginação e filtros opcionais.
   */
  @Get('gaps')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Listar gaps NSU detectados' })
  @ApiQuery({ name: 'cnpj', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDENTE', 'RECUPERADO', 'INEXISTENTE', 'ESGOTADO'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listarGaps(
    @CurrentUser('tenantId') tenantId: string,
    @Query('cnpj') cnpj?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listarGaps(tenantId, {
      cnpj,
      status,
      page: page ? Number.parseInt(page, 10) : undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  /**
   * POST /dfe/gaps/:gapId/recuperar
   *
   * Força a recuperação manual de um gap NSU via `consNSU`.
   * Aceita gaps com status PENDENTE ou ESGOTADO.
   */
  @Post('gaps/:gapId/recuperar')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recuperar gap NSU manualmente via consNSU' })
  recuperarGap(
    @Param('gapId', ParseUUIDPipe) gapId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.recuperarGap(tenantId, gapId);
  }

  @Post('documentos/backfill-destinatario-cnpj')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reprocessa XMLs existentes para popular nfeDestinatarioCnpj' })
  backfillDestinatarioCnpj(@CurrentUser('tenantId') tenantId: string) {
    return this.xmlProcessor.backfillDestinatarioCnpj(tenantId);
  }

  @Post('documentos/backfill-transportador-autxml')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reprocessa XMLs existentes para popular transportador e autXML' })
  backfillTransportadorAutXml(@CurrentUser('tenantId') tenantId: string) {
    return this.xmlProcessor.backfillTransportadorAutXml(tenantId);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Varredura retroativa de NSU (consNSU)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * POST /dfe/:configId/varredura/iniciar
   *
   * Inicia (ou reinicia) uma varredura retroativa que itera NSU por NSU via
   * consNSU para recuperar documentos históricos não capturados pelo distNSU.
   *
   * Parâmetros:
   *  - nsuInicio: NSU de partida (string com até 15 dígitos)
   *  - nsuFim:    NSU final (geralmente o maxNSU atual)
   *
   * Taxa: ~30 NSUs/min por CNPJ. Progresso em GET /:configId/varredura.
   */
  @Post(':configId/varredura/iniciar')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Iniciar varredura retroativa NSU (consNSU iterativo)' })
  async iniciarVarredura(
    @Param('configId', ParseUUIDPipe) configId: string,
    @Body() dto: IniciarVarreduraDto,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    await this.varreduraService.iniciarVarredura(tenantId, configId, dto.nsuInicio, dto.nsuFim);
    return { message: 'Varredura iniciada. Acompanhe o progresso em GET /dfe/:configId/varredura.' };
  }

  /**
   * POST /dfe/:configId/varredura/pausar
   *
   * Pausa a varredura ativa. O progresso é salvo e pode ser retomado.
   */
  @Post(':configId/varredura/pausar')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pausar varredura retroativa NSU' })
  async pausarVarredura(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    await this.varreduraService.pausarVarredura(tenantId, configId);
    return { message: 'Varredura pausada.' };
  }

  /**
   * POST /dfe/:configId/varredura/retomar
   *
   * Retoma uma varredura pausada do ponto onde parou.
   */
  @Post(':configId/varredura/retomar')
  @RequiresPermission('dfe.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retomar varredura retroativa NSU pausada' })
  async retomarVarredura(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    await this.varreduraService.retomarVarredura(tenantId, configId);
    return { message: 'Varredura retomada.' };
  }

  /**
   * GET /dfe/:configId/varredura
   *
   * Retorna o status atual da varredura: progresso, NSU atual, documentos
   * recuperados e estimativa de conclusão.
   */
  @Get(':configId/varredura')
  @RequiresPermission('dfe.view')
  @ApiOperation({ summary: 'Status da varredura retroativa NSU' })
  statusVarredura(
    @Param('configId', ParseUUIDPipe) configId: string,
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.varreduraService.getStatus(tenantId, configId);
  }
}
