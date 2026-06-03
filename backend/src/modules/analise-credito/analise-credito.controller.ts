import {
  Controller, Logger, Post, Get, Param, Query, UseGuards,
  HttpCode, HttpStatus, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Prisma, AuditAcao } from '@prisma/client';
import { P01Service }    from './p01/p01.service';
import { P01Job }        from './p01/p01.job';
import { P02Service }    from './p02/p02.service';
import { P03Service }    from './p03/p03.service';
import { P04Service }    from './p04/p04.service';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard }  from '../../common/guards/jwt-auth.guard';
import { CurrentUser }   from '../../common/decorators/current-user.decorator';
import { Audit }         from '../../common/interceptors/audit.interceptor';

@UseGuards(JwtAuthGuard)
@Controller('analise-credito')
export class AnaliseCreditoController {
  private readonly logger = new Logger(AnaliseCreditoController.name);

  constructor(
    private readonly p01Service: P01Service,
    private readonly p01Job:     P01Job,
    private readonly p02Service: P02Service,
    private readonly p03Service: P03Service,
    private readonly p04Service: P04Service,
    private readonly prisma:     PrismaService,
  ) {}

  // ─── P01 ──────────────────────────────────────────────────────────────────────

  @Post('p01/processar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoP01')
  async dispararP01(
    @CurrentUser('tenantId') tenantId: string,
    @Query('forcar') forcar?: string,
  ) {
    void this.p01Service.processarTodos(tenantId, {
      forcarReprocessamento: forcar === 'true',
    }).catch(err => this.logger.error('[P01] Erro em background', err instanceof Error ? err.stack : String(err)));
    return { mensagem: 'P01 iniciado em background', status: 'aceito' };
  }

  @Post('p01/processar/:cnpj')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoP01')
  async dispararP01Cnpj(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
    @Query('forcar') forcar?: string,
  ) {
    void this.p01Service.processarCnpj(tenantId, cnpj, {
      forcarReprocessamento: forcar === 'true',
    }).catch(err => this.logger.error(`[P01] Erro em background (${cnpj})`, err instanceof Error ? err.stack : String(err)));
    return { mensagem: `P01 iniciado para CNPJ ${cnpj}`, status: 'aceito' };
  }

  @Get('p01/status/:cnpj')
  async statusP01(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    return this.p01Service.statusPorCnpj(tenantId, cnpj);
  }

  // ─── P02 ──────────────────────────────────────────────────────────────────────

  @Post('p02/processar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoP02')
  async dispararP02(@CurrentUser('tenantId') tenantId: string) {
    void this.p02Service.processarTodos(tenantId)
      .catch(err => this.logger.error('[P02] Erro em background', err instanceof Error ? err.stack : String(err)));
    return { mensagem: 'P02 iniciado em background', status: 'aceito' };
  }

  // ─── P03 ──────────────────────────────────────────────────────────────────────

  @Post('p03/processar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoP03')
  async dispararP03(@CurrentUser('tenantId') tenantId: string) {
    void this.p03Service.processarTodos(tenantId)
      .catch(err => this.logger.error('[P03] Erro em background', err instanceof Error ? err.stack : String(err)));
    return { mensagem: 'P03 iniciado em background', status: 'aceito' };
  }

  // ─── P04 ──────────────────────────────────────────────────────────────────────

  @Post('p04/processar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoP04')
  async dispararP04(@CurrentUser('tenantId') tenantId: string) {
    void this.p04Service.processarTodos(tenantId)
      .catch(err => this.logger.error('[P04] Erro em background', err instanceof Error ? err.stack : String(err)));
    return { mensagem: 'P04 iniciado em background', status: 'aceito' };
  }

  // ─── Pipeline completo P01→P04 ────────────────────────────────────────────────
  // Usa P01Job.executar para reutilizar o guard de concorrência (this.running)

  @Post('pipeline/processar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoPipeline')
  async dispararPipeline(@CurrentUser('tenantId') tenantId: string) {
    void this.p01Job.executar(tenantId)
      .catch(err => this.logger.error('[Pipeline] Erro em background', err instanceof Error ? err.stack : String(err)));
    return { mensagem: 'Pipeline P01→P04 iniciado em background', status: 'aceito' };
  }

  // ─── Leitura para o dashboard ─────────────────────────────────────────────────

  /** Lista todas as empresas do tenant com última classificação — alimenta o seletor */
  @Get('empresas')
  async listarEmpresas(@CurrentUser('tenantId') tenantId: string) {
    const empresas = await this.prisma.creditoEmpresa.findMany({
      where:   { tenantId },
      include: { classificacoes: { orderBy: { exercicio: 'desc' }, take: 1 } },
      orderBy: { razaoSocial: 'asc' },
    });
    return empresas.map(e => ({
      cnpj:                e.cnpj,
      razaoSocial:         e.razaoSocial,
      regimeTributario:    e.regimeTributario,
      ultimaClassificacao: e.classificacoes[0] ?? null,
    }));
  }

  /** Status do pipeline por exercício para um CNPJ */
  @Get('empresas/:cnpj/status')
  async statusPipeline(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    // Ordenação por timestampProcessamento desc: primeiro registro por tabelaDestino = mais recente
    const procs = await this.prisma.creditoProcessamento.findMany({
      where:   { empresaId: empresa.id },
      orderBy: [{ exercicio: 'desc' }, { timestampProcessamento: 'desc' }],
    });

    // Indexa o registro mais recente por exercício × tabelaDestino
    type ProcRow = (typeof procs)[number];
    const porAno = new Map<number, Map<string, ProcRow>>();
    for (const p of procs) {
      if (!porAno.has(p.exercicio)) porAno.set(p.exercicio, new Map());
      porAno.get(p.exercicio)!.set(p.tabelaDestino, p);
      // Map.get sempre retorna value após o set acima — não há risco de undefined
    }

    return Array.from(porAno.entries())
      .sort(([a], [b]) => b - a)
      .map(([exercicio, tabelas]) => {
        const versaoOk = (chave: string) => {
          const r = tabelas.get(chave);
          return r?.registrosBloqueados === 0 ? r.versaoPrompt : null;
        };
        const totalBloqueios = [...tabelas.values()]
          .reduce((s, r) => s + r.registrosBloqueados, 0);
        return {
          exercicio,
          p01: versaoOk('tb_ecd_saldos'),
          p02: versaoOk('tb_balanco'),
          p03: versaoOk('tb_indicadores'),
          p04: versaoOk('tb_classificacoes'),
          totalBloqueios,
        };
      });
  }

  /** Indicadores financeiros de um CNPJ, opcionalmente filtrados por exercício */
  @Get('empresas/:cnpj/indicadores')
  async indicadores(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
    @Query('exercicio') exercicioStr?: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const exercicio = this.parseExercicio(exercicioStr);
    const where: Prisma.CreditoIndicadorWhereInput = { empresaId: empresa.id };
    if (exercicio !== undefined) where.exercicio = exercicio;

    return this.prisma.creditoIndicador.findMany({
      where,
      orderBy: [{ exercicio: 'desc' }, { indicador: 'asc' }],
    });
  }

  /** Alertas de um CNPJ, opcionalmente filtrados por exercício */
  @Get('empresas/:cnpj/alertas')
  async alertas(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
    @Query('exercicio') exercicioStr?: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const exercicio = this.parseExercicio(exercicioStr);
    const where: Prisma.CreditoAlertaWhereInput = { empresaId: empresa.id };
    if (exercicio !== undefined) where.exercicio = exercicio;

    return this.prisma.creditoAlerta.findMany({
      where,
      orderBy: [{ exercicio: 'desc' }, { severidade: 'asc' }, { codigoRegra: 'asc' }],
    });
  }

  /** Histórico de classificações de risco de um CNPJ */
  @Get('empresas/:cnpj/classificacao')
  async classificacao(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    return this.prisma.creditoClassificacao.findMany({
      where:   { empresaId: empresa.id },
      orderBy: { exercicio: 'desc' },
    });
  }

  /** Inconsistências de um CNPJ (últimas 100) */
  @Get('empresas/:cnpj/inconsistencias')
  async inconsistencias(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    return this.prisma.creditoInconsistencia.findMany({
      where:   { empresaId: empresa.id },
      orderBy: { criadoEm: 'desc' },
      take:    100,
    });
  }

  /** Exercícios disponíveis para um CNPJ (baseado em registros ECF processados) */
  @Get('empresas/:cnpj/exercicios')
  async exercicios(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);
    const rows = await this.prisma.creditoEcfRegistro.findMany({
      where:    { empresaId: empresa.id },
      select:   { exercicio: true },
      distinct: ['exercicio'],
      orderBy:  { exercicio: 'desc' },
    });
    return rows.map(r => r.exercicio);
  }

  /** Balanço Patrimonial (L100) ou DRE (L300) de um CNPJ/exercício */
  @Get('empresas/:cnpj/demonstracoes')
  async demonstracoes(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
    @Query('tipo') tipo: string,
    @Query('exercicio') exercicioStr?: string,
    @Query('contaRef') contaRef?: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const exercicio = this.parseExercicio(exercicioStr);
    if (exercicio === undefined) throw new BadRequestException('exercicio é obrigatório');

    const registroEcf = tipo === 'dre' ? 'L300' : 'L100';
    const where: Prisma.CreditoEcfRegistroWhereInput = {
      empresaId: empresa.id,
      exercicio,
      registroEcf,
    };
    if (contaRef?.trim()) where.linhaCodigo = { startsWith: contaRef.trim() };

    const registros = await this.prisma.creditoEcfRegistro.findMany({
      where,
      orderBy: { linhaCodigo: 'asc' },
      select:  { linhaCodigo: true, descricao: true, valor: true },
    });

    // Determina haFilhos em O(n) usando o conjunto de prefixos dos pais
    const parentCodes = new Set(
      registros
        .map(r => r.linhaCodigo.split('.').slice(0, -1).join('.'))
        .filter(Boolean),
    );

    return registros.map(r => ({
      linhaCodigo: r.linhaCodigo,
      descricao:   r.descricao,
      valor:       r.valor,
      nivel:       r.linhaCodigo.split('.').length,
      haFilhos:    parentCodes.has(r.linhaCodigo),
      natureza:    registroEcf === 'L100'
        ? (r.linhaCodigo.startsWith('1') ? 'DEVEDOR' : 'CREDOR')
        : (r.valor.greaterThanOrEqualTo(0) ? 'CREDOR' : 'DEVEDOR'),
    }));
  }

  // ─── Helper ───────────────────────────────────────────────────────────────────

  private parseExercicio(value?: string): number | undefined {
    if (!value) return undefined;
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) throw new BadRequestException('exercicio deve ser um número inteiro');
    return n;
  }
}
