import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  Matches,
  IsOptional,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { FaturamentoProcessamentoService } from './faturamento-processamento.service';
import { FaturamentoQueryService } from './faturamento-query.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class ProcessarArquivoDto {
  @IsString() @IsNotEmpty()
  empresaId: string;

  @IsString() @IsNotEmpty()
  cnpj: string;

  @IsString() @Matches(/^gs:\/\//)
  gcsUri: string;
}

class ProcessarLoteDto {
  @IsOptional()
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  ano?: number;
}

class ListarQueryDto {
  @IsOptional() @IsString()
  cnpj?: string;

  @IsOptional()
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  ano?: number;

  @IsOptional()
  @Type(() => Number) @IsInt() @Min(1) @Max(12)
  mes?: number;

  @IsOptional() @IsIn(['EFD_ICMS', 'EFD_CONTRIB', 'AMBOS'])
  fonte?: string;
}

class ConsolidadoQueryDto {
  @IsString() @IsNotEmpty()
  empresaId: string;

  @IsOptional()
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  anoInicio?: number;

  @IsOptional()
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  anoFim?: number;

  @IsOptional() @IsIn(['EFD_ICMS', 'EFD_CONTRIB', 'AMBOS'])
  fonte?: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@ApiTags('faturamento')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('faturamento')
export class FaturamentoController {
  private readonly logger = new Logger(FaturamentoController.name);

  constructor(
    private readonly processamento: FaturamentoProcessamentoService,
    private readonly query: FaturamentoQueryService,
    private readonly prisma: PrismaService,
  ) {}

  // ── EFD ICMS/IPI ────────────────────────────────────────────────────────────

  /**
   * Processa um único arquivo EFD ICMS/IPI informado via URI GCS.
   * Após persistir EFD_ICMS, mescla automaticamente com EFD_CONTRIB se já existir.
   */
  @Post('processar-arquivo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Processa um arquivo EFD ICMS/IPI e extrai o faturamento' })
  @RequiresPermission('faturamento:processar')
  async processarArquivo(
    @Body() dto: ProcessarArquivoDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.processamento.processarArquivo({
      tenantId: user.tenantId,
      empresaId: dto.empresaId,
      cnpj: dto.cnpj,
      gcsUri: dto.gcsUri,
    });
  }

  /**
   * Descobre e processa todos os EFD_ICMS disponíveis no sped_arquivos para o tenant.
   */
  @Post('processar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Processa todos os EFD ICMS/IPI disponíveis do tenant' })
  @RequiresPermission('faturamento:processar')
  async processarTodos(
    @Body() dto: ProcessarLoteDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    const resultados = await this.processamento.processarTodos(user.tenantId, dto.ano);
    return { processados: resultados.length, resultados };
  }

  // ── EFD Contribuições ────────────────────────────────────────────────────────

  /**
   * Processa um único arquivo EFD Contribuições informado via URI GCS.
   * Extrai receitas de serviços ISS (A100) e PIS/COFINS apurado.
   * Após persistir EFD_CONTRIB, mescla automaticamente com EFD_ICMS se já existir.
   */
  @Post('processar-contrib-arquivo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Processa um arquivo EFD Contribuições e extrai receita de serviços' })
  @RequiresPermission('faturamento:processar')
  async processarContribArquivo(
    @Body() dto: ProcessarArquivoDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.processamento.processarContribArquivo({
      tenantId: user.tenantId,
      empresaId: dto.empresaId,
      cnpj: dto.cnpj,
      gcsUri: dto.gcsUri,
    });
  }

  /**
   * Descobre e processa todos os EFD_CONTRIBUICOES disponíveis no sped_arquivos.
   */
  @Post('processar-contrib')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Processa todos os EFD Contribuições disponíveis do tenant' })
  @RequiresPermission('faturamento:processar')
  async processarContribTodos(
    @Body() dto: ProcessarLoteDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    const resultados = await this.processamento.processarContribTodos(user.tenantId, dto.ano);
    return { processados: resultados.length, resultados };
  }

  /**
   * Re-executa a mesclagem AMBOS para uma competência específica.
   * Útil quando os dois arquivos foram processados em momentos diferentes.
   */
  @Post('mesclar/:empresaId/:ano/:mes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remescla EFD_ICMS + EFD_CONTRIB para uma competência' })
  @RequiresPermission('faturamento:processar')
  async mesclar(
    @Param('empresaId') empresaId: string,
    @Param('ano') anoStr: string,
    @Param('mes') mesStr: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    const ano = Number.parseInt(anoStr, 10);
    const mes = Number.parseInt(mesStr, 10);
    if (!ano || ano < 2000 || ano > 2100 || !mes || mes < 1 || mes > 12) {
      throw new BadRequestException('ano (2000-2100) e mes (1-12) inválidos');
    }
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada');
    const mesclado = await this.processamento.mesclarCompetencias(user.tenantId, empresaId, ano, mes);
    return { mesclado };
  }

  // ── Consultas ────────────────────────────────────────────────────────────────

  /**
   * Lista as competências de faturamento processadas para o tenant.
   * Filtra por cnpj, ano, mes e/ou fonte (EFD_ICMS | EFD_CONTRIB | AMBOS).
   */
  @Get()
  @ApiOperation({ summary: 'Lista competências de faturamento processadas' })
  @RequiresPermission('faturamento:visualizar')
  async listar(
    @Query() query: ListarQueryDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.prisma.faturamentoCompetencia.findMany({
      where: {
        tenantId: user.tenantId,
        ...(query.cnpj  ? { cnpj: query.cnpj }   : {}),
        ...(query.ano   ? { ano: query.ano }       : {}),
        ...(query.mes   ? { mes: query.mes }       : {}),
        ...(query.fonte ? { fonte: query.fonte }   : {}),
      },
      orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      select: {
        id: true, empresaId: true, cnpj: true,
        ano: true, mes: true, fonte: true,
        vlFaturamentoBruto: true, vlIcms: true, vlIpi: true,
        vlPis: true, vlCofins: true, qtdDocumentos: true,
        processadoEm: true,
      },
    });
  }

  /**
   * Faturamento anual consolidado (soma dos meses) para uma empresa.
   * Retorna séries mensais para gráfico + totais.
   * Por padrão usa fonte=AMBOS quando disponível, senão EFD_ICMS.
   */
  @Get('anual')
  @ApiOperation({ summary: 'Faturamento anual consolidado por empresa' })
  @RequiresPermission('faturamento:visualizar')
  async anual(
    @Query('cnpj') cnpj: string,
    @Query('ano') anoStr: string,
    @Query('fonte') fonteParam: string | undefined,
    @CurrentUser() user: { tenantId: string },
  ) {
    const fonte = fonteParam ?? 'AMBOS';
    if (!['EFD_ICMS', 'EFD_CONTRIB', 'AMBOS'].includes(fonte)) {
      throw new BadRequestException('fonte inválida: use EFD_ICMS, EFD_CONTRIB ou AMBOS');
    }
    if (!cnpj || !anoStr) throw new BadRequestException('cnpj e ano são obrigatórios');
    const ano = Number.parseInt(anoStr, 10);
    if (ano < 2000 || ano > 2100) throw new BadRequestException('ano inválido');

    const competencias = await this.prisma.faturamentoCompetencia.findMany({
      where: { tenantId: user.tenantId, cnpj, ano, fonte },
      orderBy: { mes: 'asc' },
      select: {
        mes: true,
        vlFaturamentoBruto: true, vlIcms: true, vlIpi: true,
        vlPis: true, vlCofins: true, qtdDocumentos: true,
        vlComprasBruto: true, qtdDocumentosCompras: true,
      },
    });

    const total = (key: keyof typeof competencias[0]) =>
      competencias.reduce((acc, c) => acc + Number(c[key] ?? 0), 0);

    return {
      cnpj,
      ano,
      fonte,
      totalFaturamentoBruto: total('vlFaturamentoBruto'),
      totalComprasBruto:     total('vlComprasBruto'),
      totalIcms:             total('vlIcms'),
      totalIpi:              total('vlIpi'),
      totalPis:              total('vlPis'),
      totalCofins:           total('vlCofins'),
      totalDocumentos:       competencias.reduce((acc, c) => acc + c.qtdDocumentos, 0),
      mesesProcessados:      competencias.length,
      mensal: competencias.map(c => ({
        mes:                  c.mes,
        vlFaturamentoBruto:   Number(c.vlFaturamentoBruto),
        vlComprasBruto:       Number(c.vlComprasBruto),
        vlIcms:               Number(c.vlIcms),
        vlIpi:                Number(c.vlIpi),
        vlPis:                Number(c.vlPis),
        vlCofins:             Number(c.vlCofins),
        qtdDocumentos:        c.qtdDocumentos,
      })),
    };
  }

  /**
   * Faturamento consolidado multi-ano para uma empresa.
   * Cada ano agrega a soma de todos os meses (fonte=AMBOS por padrão).
   * GROUP BY executado no banco via FaturamentoQueryService + cache 1h.
   */
  @Get('consolidado')
  @ApiOperation({ summary: 'Faturamento consolidado por ano (multi-ano)' })
  @RequiresPermission('faturamento:visualizar')
  async consolidado(
    @Query() q: ConsolidadoQueryDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    if (!q.empresaId) throw new BadRequestException('empresaId é obrigatório');
    const fonte     = q.fonte    ?? 'AMBOS';
    const anoInicio = q.anoInicio ?? new Date().getFullYear() - 4;
    const anoFim    = q.anoFim    ?? new Date().getFullYear();

    const empresa = await this.prisma.empresa.findFirst({
      where: { id: q.empresaId, tenantId: user.tenantId },
      select: { id: true, cnpj: true, nome: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada');

    const anos = await this.query.consolidado({
      tenantId: user.tenantId,
      empresaId: q.empresaId,
      fonte,
      anoInicio,
      anoFim,
    });

    return { empresaId: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome, fonte, anoInicio, anoFim, anos };
  }

  /**
   * Faturamento dos últimos 12 meses (LTM) + carga tributária efetiva.
   */
  @Get('ltm')
  @ApiOperation({ summary: 'Faturamento LTM (últimos 12 meses) + carga tributária' })
  @RequiresPermission('faturamento:visualizar')
  async ltm(
    @Query() q: ConsolidadoQueryDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    if (!q.empresaId) throw new BadRequestException('empresaId é obrigatório');
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: q.empresaId, tenantId: user.tenantId },
      select: { id: true, cnpj: true, nome: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada');

    const ltm = await this.query.ltm({ tenantId: user.tenantId, empresaId: q.empresaId, fonte: q.fonte ?? 'EFD_ICMS' });
    return { empresaId: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome, ...ltm };
  }

  /**
   * Consolidado multi-ano com breakdown por categoria de CFOP.
   * GROUP BY + string_agg executados no banco via FaturamentoQueryService + cache 1h.
   */
  @Get('cfops-consolidado')
  @ApiOperation({ summary: 'Faturamento consolidado com breakdown de CFOPs por ano' })
  @RequiresPermission('faturamento:visualizar')
  async cfopsConsolidado(
    @Query() q: ConsolidadoQueryDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    if (!q.empresaId) throw new BadRequestException('empresaId é obrigatório');
    const fonte     = q.fonte    ?? 'AMBOS';
    const anoInicio = q.anoInicio ?? new Date().getFullYear() - 4;
    const anoFim    = q.anoFim    ?? new Date().getFullYear();

    const empresa = await this.prisma.empresa.findFirst({
      where: { id: q.empresaId, tenantId: user.tenantId },
      select: { id: true, cnpj: true, nome: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada');

    const anos = await this.query.cfopsConsolidado({
      tenantId: user.tenantId,
      empresaId: q.empresaId,
      fonte,
      anoInicio,
      anoFim,
    });

    return { empresaId: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome, fonte, anoInicio, anoFim, anos };
  }
}

