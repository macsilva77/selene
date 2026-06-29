import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EstoqueCombustivelService } from './estoque-combustivel.service';
import { EstoqueFiscalService } from './estoque-fiscal.service';

class CombustivelQueryDto {
  @IsString() @IsNotEmpty()
  empresaId: string;

  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  ano: number;
}

class FiscalQueryDto {
  @IsString() @IsNotEmpty()
  empresaId: string;

  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  ano: number;
}

@ApiTags('estoque')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('estoque')
export class EstoqueController {
  constructor(
    private readonly combustivelService: EstoqueCombustivelService,
    private readonly fiscalService: EstoqueFiscalService,
  ) {}

  @Get('combustivel')
  @ApiOperation({ summary: 'Estoque fiscal de combustível (Bloco 1300) — venda medida, perda, giro' })
  @RequiresPermission('faturamento:visualizar')
  combustivel(
    @Query() q: CombustivelQueryDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.combustivelService.combustivel(user.tenantId, q.empresaId, q.ano);
  }

  @Get('fiscal')
  @ApiOperation({ summary: 'Estoque fiscal (Bloco H + C170) — reconciliação por item, giro, pontos de atenção' })
  @RequiresPermission('faturamento:visualizar')
  fiscal(
    @Query() q: FiscalQueryDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.fiscalService.reconciliar(user.tenantId, q.empresaId, q.ano);
  }
}
