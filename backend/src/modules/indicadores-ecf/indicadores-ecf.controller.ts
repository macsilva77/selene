import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  BadRequestException,
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

/* ─── Controller ──────────────────────────────────────────────────────────── */

@ApiTags('Indicadores ECF')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('indicadores-ecf')
export class IndicadoresEcfController {
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
      anoCalendario: dto.anoCalendario,
      gcsUri: dto.gcsUri,
    });
    return { message: 'Processado com sucesso' };
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
    return this.prisma.ecfIndicador.findMany({
      where: { tenantId, cnpj: query.cnpj },
      orderBy: { anoCalendario: 'asc' },
    });
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

    const where: {
      tenantId: string;
      cnpj: string;
      anoCalendario?: { gte?: number; lte?: number };
    } = { tenantId, cnpj: query.cnpj };

    if (query.anoInicio !== undefined || query.anoFim !== undefined) {
      where.anoCalendario = {};
      if (query.anoInicio !== undefined) where.anoCalendario.gte = query.anoInicio;
      if (query.anoFim !== undefined)    where.anoCalendario.lte = query.anoFim;
    }

    return this.prisma.ecfIndicador.findMany({
      where,
      orderBy: { anoCalendario: 'asc' },
    });
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
    return this.prisma.ecfIndicador.findFirst({
      where: { tenantId, cnpj },
      orderBy: { anoCalendario: 'desc' },
    });
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
}
