import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
  StreamableFile,
  Res,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { ClientesFornecedoresQueryService } from './query/clientes-fornecedores-query.service';
import { ClientesFornecedoresExcelService } from './excel/clientes-fornecedores-excel.service';
import { ClientesFornecedoresProcessamentoService } from './clientes-fornecedores-processamento.service';
import {
  QueryRankingDto,
  QueryPorCnpjDto,
  QueryPeriodoDto,
  QueryDrillDownDto,
} from './dto/query.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequiresPermission('clientes-fornecedores.view')
@Controller('clientes-fornecedores')
export class ClientesFornecedoresController {
  private readonly logger = new Logger(ClientesFornecedoresController.name);

  constructor(
    private readonly queryService: ClientesFornecedoresQueryService,
    private readonly excelService: ClientesFornecedoresExcelService,
    private readonly processamentoService: ClientesFornecedoresProcessamentoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Lista todas as empresas que possuem SPEDs processados no tenant.
   * Usado pelo frontend para popular o select de empresa.
   */
  @Get('empresas')
  async listarEmpresas(@CurrentUser('tenantId') tenantId: string) {
    const comps = await this.prisma.clientesFornecedoresCompetencia.findMany({
      where: { tenantId, status: 'PROCESSADO' },
      distinct: ['cnpj'],
      select: { cnpj: true, empresaId: true },
    });

    if (comps.length === 0) return [];

    const empresaIds = comps.map(c => c.empresaId);
    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: empresaIds } },
      select: { id: true, nome: true, nomeFantasia: true },
    });

    const nomeMap = new Map(empresas.map(e => [e.id, e.nomeFantasia || e.nome]));

    return comps
      .map(c => ({ cnpj: c.cnpj, razaoSocial: nomeMap.get(c.empresaId) ?? c.cnpj }))
      .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'));
  }

  /**
   * Lista as competências (meses) já processadas para uma empresa.
   * Usado pelo frontend para popular os seletores de período.
   */
  @Get('competencias')
  async competencias(
    @CurrentUser('tenantId') tenantId: string,
    @Query('cnpj') cnpj: string,
  ) {
    if (!cnpj) throw new BadRequestException('cnpj é obrigatório');
    return this.prisma.clientesFornecedoresCompetencia.findMany({
      where: { tenantId, cnpj },
      select: {
        ano:             true,
        mes:             true,
        qtdClientes:     true,
        qtdFornecedores: true,
        status:          true,
        processadoEm:    true,
      },
      orderBy: [{ ano: 'asc' }, { mes: 'asc' }],
    });
  }

  /**
   * Ranking geral de participantes com classificação ABC dinâmica.
   * Aceita topN opcional para retornar apenas os N maiores.
   */
  @Get('ranking')
  async ranking(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryRankingDto,
  ) {
    this.validarPeriodo(query);
    const empresaId = await this.resolverEmpresaId(tenantId, query.cnpj);
    return this.queryService.consultarTopN({
      tenantId,
      empresaId,
      cnpjEmpresa:      query.cnpj,
      anoInicio:        query.anoInicio,
      mesInicio:        query.mesInicio,
      anoFim:           query.anoFim,
      mesFim:           query.mesFim,
      tipoParticipante: query.tipo,
      topN:             query.topN,
    });
  }

  /**
   * Busca um participante pelo CNPJ e retorna sua posição no ranking global
   * com a classificação ABC calculada sobre o universo completo do período.
   */
  @Get('por-cnpj')
  async porCnpj(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryPorCnpjDto,
  ) {
    this.validarPeriodo(query);
    const empresaId = await this.resolverEmpresaId(tenantId, query.cnpj);
    return this.queryService.consultarPorCnpj({
      tenantId,
      empresaId,
      cnpjEmpresa:      query.cnpj,
      anoInicio:        query.anoInicio,
      mesInicio:        query.mesInicio,
      anoFim:           query.anoFim,
      mesFim:           query.mesFim,
      tipoParticipante: query.tipo,
      cnpj:             query.cnpjParticipante,
    });
  }

  /**
   * Ranking consolidado por grupo econômico (raiz CNPJ).
   * A razão social de cada grupo é resolvida com prioridade para a matriz.
   */
  @Get('por-raiz')
  async porRaiz(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryPeriodoDto,
  ) {
    this.validarPeriodo(query);
    const empresaId = await this.resolverEmpresaId(tenantId, query.cnpj);
    return this.queryService.consultarPorRaiz({
      tenantId,
      empresaId,
      cnpjEmpresa:      query.cnpj,
      anoInicio:        query.anoInicio,
      mesInicio:        query.mesInicio,
      anoFim:           query.anoFim,
      mesFim:           query.mesFim,
      tipoParticipante: query.tipo,
    });
  }

  /**
   * Detalha todos os CNPJs individuais de um grupo econômico,
   * com a participação percentual dentro do grupo e flag de matriz.
   */
  @Get('drill-down')
  async drillDown(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryDrillDownDto,
  ) {
    this.validarPeriodo(query);
    const empresaId = await this.resolverEmpresaId(tenantId, query.cnpj);
    return this.queryService.consultarDrillDown({
      tenantId,
      empresaId,
      cnpjEmpresa:      query.cnpj,
      anoInicio:        query.anoInicio,
      mesInicio:        query.mesInicio,
      anoFim:           query.anoFim,
      mesFim:           query.mesFim,
      tipoParticipante: query.tipo,
      cnpjRaiz:         query.cnpjRaiz,
    });
  }

  /**
   * Exporta o ranking de clientes e fornecedores para um arquivo Excel (.xlsx)
   * com 4 abas: Clientes, Fornecedores, Grupos Clientes, Grupos Fornecedores.
   */
  @Get('exportar')
  async exportar(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryRankingDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    this.validarPeriodo(query);
    const empresaId = await this.resolverEmpresaId(tenantId, query.cnpj);
    const buffer = await this.excelService.gerarExcel({
      tenantId,
      empresaId,
      cnpjEmpresa: query.cnpj,
      anoInicio:   query.anoInicio,
      mesInicio:   query.mesInicio,
      anoFim:      query.anoFim,
      mesFim:      query.mesFim,
    });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="clientes-fornecedores.xlsx"`,
    });
    return new StreamableFile(buffer);
  }

  /**
   * Reprocessa SPEDs já disponíveis em ObrigacaoAcessoria para o tenant.
   * Para cada par EFD_ICMS_IPI + EFD_CONTRIBUICOES com mesmo CNPJ e período,
   * aciona o processamento em background e retorna imediatamente (HTTP 202).
   */
  @Post('reprocessar')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresPermission('clientes-fornecedores.processar')
  async reprocessar(@CurrentUser('tenantId') tenantId: string) {
    const empresas = await this.prisma.empresa.findMany({
      where:  { tenantId },
      select: { id: true, cnpj: true },
    });
    const cnpjToId = new Map(empresas.map(e => [e.cnpj, e.id]));
    const cnpjs    = [...cnpjToId.keys()];

    const icmsFiles = await this.prisma.obrigacaoAcessoria.findMany({
      where: {
        cnpj:                { in: cnpjs },
        tipoObrigacao:       'EFD_ICMS_IPI',
        statusProcessamento: 'Processado',
        versaoAtual:         true,
      },
      select: { cnpj: true, dataInicial: true, caminhoBucket: true },
    });

    void (async () => {
      let ok = 0;
      for (const icms of icmsFiles) {
        const empresaId = cnpjToId.get(icms.cnpj);
        if (!empresaId) continue;

        const contrib = await this.prisma.obrigacaoAcessoria.findFirst({
          where: {
            cnpj:                icms.cnpj,
            tipoObrigacao:       'EFD_CONTRIBUICOES',
            statusProcessamento: 'Processado',
            versaoAtual:         true,
            dataInicial:         icms.dataInicial,
          },
          select: { caminhoBucket: true },
        });
        if (!contrib) continue;

        const ano = icms.dataInicial.getFullYear();
        const mes = icms.dataInicial.getMonth() + 1;
        try {
          await this.processamentoService.processar({
            tenantId,
            empresaId,
            cnpj:              icms.cnpj,
            ano,
            mes,
            spedIcmsIpiGcsUri: icms.caminhoBucket,
            spedContribGcsUri: contrib.caminhoBucket,
          });
          ok++;
        } catch (err) {
          this.logger.warn(`[Reprocessar] ${icms.cnpj} ${ano}/${mes}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.logger.log(`[Reprocessar] tenant=${tenantId} — ${ok}/${icmsFiles.length} competência(s) concluída(s)`);
    })().catch(err =>
      this.logger.error('[Reprocessar] Erro em background', err instanceof Error ? err.stack : String(err)),
    );

    return {
      mensagem: `Reprocessamento iniciado para até ${icmsFiles.length} competência(s)`,
      status:   'aceito',
      total:    icmsFiles.length,
    };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────────

  /** Lança 400 se anoFim/mesFim for anterior a anoInicio/mesInicio. */
  private validarPeriodo(dto: QueryPeriodoDto): void {
    const ymInicio = dto.anoInicio * 100 + dto.mesInicio;
    const ymFim    = dto.anoFim    * 100 + dto.mesFim;
    if (ymFim < ymInicio) {
      throw new BadRequestException(
        `O período fim (${dto.anoFim}/${dto.mesFim}) deve ser posterior ao período início (${dto.anoInicio}/${dto.mesInicio})`,
      );
    }
  }

  /**
   * Resolve o empresaId a partir do CNPJ da empresa.
   * Lança 404 se não há nenhuma competência processada para esse CNPJ no tenant.
   */
  private async resolverEmpresaId(tenantId: string, cnpj: string): Promise<string> {
    const comp = await this.prisma.clientesFornecedoresCompetencia.findFirst({
      where: { tenantId, cnpj },
      select: { empresaId: true },
    });
    if (!comp) {
      throw new NotFoundException(
        `Empresa CNPJ ${cnpj} não possui dados de clientes/fornecedores processados`,
      );
    }
    return comp.empresaId;
  }
}
