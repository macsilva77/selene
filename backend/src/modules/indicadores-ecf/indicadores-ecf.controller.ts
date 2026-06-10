import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
  BadRequestException,
  Logger,
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
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { IndicadoresEcfProcessamentoService } from './indicadores-ecf-processamento.service';

/* ─── DTOs ────────────────────────────────────────────────────────────────── */

class ProcessarEcfDto {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  cnpj: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anoCalendario: number;

  @IsString()
  @Matches(/^gs:\/\//)
  gcsUri: string;
}

class IndividualQueryDto {
  @IsString()
  @IsNotEmpty()
  cnpj: string;
}

class HistoricoQueryDto {
  @IsString()
  @IsNotEmpty()
  cnpj: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anoInicio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anoFim?: number;
}

class BuscarQueryDto {
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  faturamentoMin?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  faturamentoMax?: number;

  @IsOptional()
  @Transform(({ value }: { value: string }) => value === 'true')
  @IsBoolean()
  temPrejuizo?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  ano?: number;
}

/* ─── Helper ─────────────────────────────────────────────────────────────── */

function deduplicarPorAno<T extends { anoCalendario: number; faturamentoDeclarado: unknown }>(rows: T[]): T[] {
  const mapa = new Map<number, T>();
  for (const row of rows) {
    const existente = mapa.get(row.anoCalendario);
    if (!existente || Number(row.faturamentoDeclarado) > Number(existente.faturamentoDeclarado)) {
      mapa.set(row.anoCalendario, row);
    }
  }
  return [...mapa.values()].sort((a, b) => a.anoCalendario - b.anoCalendario);
}

/* ─── Controller ──────────────────────────────────────────────────────────── */

@ApiTags('Indicadores ECF')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('indicadores-ecf')
export class IndicadoresEcfController {
  private readonly logger = new Logger(IndicadoresEcfController.name);

  constructor(
    private readonly processamentoService: IndicadoresEcfProcessamentoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Processa um arquivo ECF e persiste os indicadores.
   */
  @Post('processar')
  @RequiresPermission('indicadores-ecf.processar')
  @ApiOperation({ summary: 'Processa ECF e extrai indicadores econômico-fiscais' })
  async processar(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: ProcessarEcfDto,
  ): Promise<{ message: string }> {
    await this.processamentoService.processar({
      tenantId,
      empresaId: dto.empresaId,
      cnpj:      dto.cnpj,
      anoCalendario: dto.anoCalendario,
      gcsUri: dto.gcsUri,
    });
    return { message: 'Processado com sucesso' };
  }

  /**
   * Reprocessa todos os ECFs disponíveis em ObrigacaoAcessoria para o tenant.
   * Aciona o processamento em background e retorna HTTP 202 imediatamente.
   */
  @Post('reprocessar')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequiresPermission('indicadores-ecf.processar')
  @ApiOperation({ summary: 'Reprocessa todos os ECFs do tenant em background' })
  async reprocessar(@CurrentUser('tenantId') tenantId: string) {
    const empresas = await this.prisma.empresa.findMany({
      where:  { tenantId },
      select: { id: true, cnpj: true },
    });
    const cnpjToId = new Map(empresas.map(e => [e.cnpj, e.id]));

    const ecfFiles = await this.prisma.obrigacaoAcessoria.findMany({
      where: {
        cnpj:                { in: [...cnpjToId.keys()] },
        tipoObrigacao:       'ECF',
        statusProcessamento: 'Processado',
        versaoAtual:         true,
      },
      select: { cnpj: true, dataInicial: true, caminhoBucket: true },
    });

    void (async () => {
      let ok = 0;
      for (const ecf of ecfFiles) {
        const empresaId = cnpjToId.get(ecf.cnpj);
        if (!empresaId) continue;
        try {
          await this.processamentoService.processar({
            tenantId,
            empresaId,
            cnpj:          ecf.cnpj,
            anoCalendario: ecf.dataInicial.getFullYear(),
            gcsUri:        ecf.caminhoBucket,
          });
          ok++;
        } catch (err) {
          this.logger.warn(`[Reprocessar] ${ecf.cnpj}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.logger.log(`[Reprocessar] tenant=${tenantId} — ${ok}/${ecfFiles.length} ECF(s) concluído(s)`);
    })().catch(err =>
      this.logger.error('[Reprocessar] Erro em background', err instanceof Error ? err.stack : String(err)),
    );

    return {
      mensagem: `Reprocessamento ECF iniciado para ${ecfFiles.length} arquivo(s)`,
      status:   'aceito',
      total:    ecfFiles.length,
    };
  }

  /**
   * Lista as empresas do tenant que possuem indicadores ECF processados.
   */
  @Get('empresas')
  @RequiresPermission('indicadores-ecf.view')
  @ApiOperation({ summary: 'Empresas do tenant com dados ECF' })
  async empresas(@CurrentUser('tenantId') tenantId: string) {
    // Agrupa por empresaId (robusto mesmo se ecfIndicador.cnpj estiver incorreto)
    const comIndicadores = await this.prisma.ecfIndicador.findMany({
      where: { tenantId },
      distinct: ['empresaId'],
      select: { empresaId: true },
    });
    if (comIndicadores.length === 0) return [];

    const empresaIds = comIndicadores.map(i => i.empresaId);
    const empresas = await this.prisma.empresa.findMany({
      where: { id: { in: empresaIds } },
      select: { cnpj: true, nome: true, nomeFantasia: true },
    });

    return empresas
      .map(e => ({ cnpj: e.cnpj, razaoSocial: e.nomeFantasia || e.nome }))
      .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'));
  }

  /**
   * Retorna todos os registros de um CNPJ (todos os anos).
   */
  @Get('individual')
  @RequiresPermission('indicadores-ecf.view')
  @ApiOperation({ summary: 'Indicadores de um CNPJ em todos os anos' })
  async individual(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: IndividualQueryDto,
  ) {
    if (!query.cnpj) throw new BadRequestException('cnpj é obrigatório');
    const empresaId = await this.resolverEmpresaId(tenantId, query.cnpj);
    const rows = await this.prisma.ecfIndicador.findMany({
      where: { tenantId, empresaId },
      orderBy: { anoCalendario: 'asc' },
    });
    return deduplicarPorAno(rows);
  }

  /**
   * Retorna a série histórica filtrada por intervalo de anos.
   */
  @Get('historico')
  @RequiresPermission('indicadores-ecf.view')
  @ApiOperation({ summary: 'Série histórica de indicadores ECF por CNPJ' })
  async historico(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: HistoricoQueryDto,
  ) {
    if (!query.cnpj) throw new BadRequestException('cnpj é obrigatório');

    const empresaId = await this.resolverEmpresaId(tenantId, query.cnpj);
    const where: {
      tenantId: string;
      empresaId: string;
      anoCalendario?: { gte?: number; lte?: number };
    } = { tenantId, empresaId };

    if (query.anoInicio !== undefined || query.anoFim !== undefined) {
      where.anoCalendario = {};
      if (query.anoInicio !== undefined) where.anoCalendario.gte = query.anoInicio;
      if (query.anoFim !== undefined)    where.anoCalendario.lte = query.anoFim;
    }

    const rows = await this.prisma.ecfIndicador.findMany({
      where,
      orderBy: { anoCalendario: 'asc' },
    });
    return deduplicarPorAno(rows);
  }

  /**
   * Retorna o registro mais recente do CNPJ para cards de dashboard.
   */
  @Get('consolidado')
  @RequiresPermission('indicadores-ecf.view')
  @ApiOperation({ summary: 'Último registro ECF do CNPJ (dashboard)' })
  async consolidado(
    @CurrentUser('tenantId') tenantId: string,
    @Query('cnpj') cnpj: string,
  ) {
    if (!cnpj) throw new BadRequestException('cnpj é obrigatório');
    const empresaId = await this.resolverEmpresaId(tenantId, cnpj);
    const rows = await this.prisma.ecfIndicador.findMany({
      where: { tenantId, empresaId },
      orderBy: { anoCalendario: 'desc' },
    });
    const deduped = deduplicarPorAno(rows);
    return deduped.at(-1) ?? null;
  }

  /**
   * Retorna todas as empresas do tenant que atendem aos filtros.
   */
  @Get('buscar')
  @RequiresPermission('indicadores-ecf.view')
  @ApiOperation({ summary: 'Busca indicadores ECF por filtros' })
  async buscar(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: BuscarQueryDto,
  ) {
    const where: Record<string, unknown> = { tenantId };

    if (query.faturamentoMin !== undefined || query.faturamentoMax !== undefined) {
      const faturamento: Record<string, number> = {};
      if (query.faturamentoMin !== undefined) faturamento['gte'] = query.faturamentoMin;
      if (query.faturamentoMax !== undefined) faturamento['lte'] = query.faturamentoMax;
      where['faturamentoDeclarado'] = faturamento;
    }

    if (query.temPrejuizo === true) {
      where['prejuizoFiscalAcumulado'] = { gt: 0 };
    } else if (query.temPrejuizo === false) {
      where['prejuizoFiscalAcumulado'] = { equals: 0 };
    }

    if (query.ano !== undefined) {
      where['anoCalendario'] = query.ano;
    }

    return this.prisma.ecfIndicador.findMany({
      where,
      orderBy: [{ anoCalendario: 'desc' }, { razaoSocial: 'asc' }],
    });
  }

  private async resolverEmpresaId(tenantId: string, cnpj: string): Promise<string> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { tenantId, cnpj },
      select: { id: true },
    });
    if (!empresa) throw new BadRequestException(`Empresa com CNPJ ${cnpj} não encontrada`);
    return empresa.id;
  }
}
