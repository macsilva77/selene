import {
  Controller, Get, Post, Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SimplesNacionalService } from './simples-nacional.service';
import { PgdasCrawlerService } from './pgdas-crawler.service';
import { IsString, Matches } from 'class-validator';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class CnpjBodyDto {
  @IsString()
  @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos sem máscara' })
  cnpj!: string;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('Simples Nacional')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('simples-nacional')
export class SimplesNacionalController {
  constructor(
    private readonly snService: SimplesNacionalService,
    private readonly pgdasCrawler: PgdasCrawlerService,
  ) {}

  // ── GET /simples-nacional ─────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Lista a situação SN de todas as empresas do tenant' })
  listar(@CurrentUser() user: { tenantId: string }) {
    return this.snService.listarSituacoes(user.tenantId);
  }

  // ── POST /simples-nacional/verificar ─────────────────────────────────────

  @Post('verificar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consulta o status Simples Nacional de um CNPJ via BrasilAPI (não persiste)' })
  consultarCnpj(@Body() dto: CnpjBodyDto) {
    return this.snService.consultarCnpj(dto.cnpj);
  }

  // ── POST /simples-nacional/varredura ──────────────────────────────────────

  @Post('varredura')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verifica status SN de todas as empresas sem SPED EFD_ICMS no ano corrente',
    description: 'Pode demorar vários segundos dependendo da quantidade de empresas (rate limit BrasilAPI ~3 req/s)',
  })
  varrer(@CurrentUser() user: { tenantId: string }) {
    return this.snService.varrerEmpresasSemSped(user.tenantId);
  }

  // ── POST /simples-nacional/empresa/:empresaId/verificar ───────────────────

  @Post('empresa/:empresaId/verificar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica e persiste a situação SN de uma empresa específica' })
  verificarEmpresa(
    @CurrentUser() user: { tenantId: string },
    @Param('empresaId') empresaId: string,
  ) {
    return this.snService.verificarEmpresa(user.tenantId, empresaId);
  }

  // ── POST /simples-nacional/empresa/:empresaId/pgdas ───────────────────────

  @Post('empresa/:empresaId/pgdas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Busca e extrai o PGDAS-D da empresa via certificado A1',
    description:
      'Requer que o certificado A1 da empresa esteja cadastrado. ' +
      'Acessa o portal do Simples Nacional com autenticação mTLS e extrai as declarações mensais.',
  })
  async buscarPgdas(
    @CurrentUser() user: { tenantId: string },
    @Param('empresaId') empresaId: string,
  ) {
    const declaracoes = await this.pgdasCrawler.crawl(user.tenantId, empresaId);
    return { empresaId, totalPeriodos: declaracoes.length, declaracoes };
  }

  // ── GET /simples-nacional/empresa/:empresaId/pgdas ────────────────────────

  @Get('empresa/:empresaId/pgdas')
  @ApiOperation({ summary: 'Retorna as declarações PGDAS-D já armazenadas para a empresa' })
  listarPgdas(
    @CurrentUser() user: { tenantId: string },
    @Param('empresaId') empresaId: string,
  ) {
    return this.snService.listarPgdas(user.tenantId, empresaId);
  }
}
