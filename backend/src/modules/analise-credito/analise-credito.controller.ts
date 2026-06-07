import {
  Controller, Logger, Post, Get, Param, Query, UseGuards,
  HttpCode, HttpStatus, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Prisma, AuditAcao } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { P01Service }    from './p01/p01.service';
import { P01Job }        from './p01/p01.job';
import { P02Service }    from './p02/p02.service';
import { P03Service }    from './p03/p03.service';
import { P04Service }    from './p04/p04.service';
import { EcfDataSourceService } from './infrastructure/ecf-data-source.service';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard }  from '../../common/guards/jwt-auth.guard';
import { CurrentUser }   from '../../common/decorators/current-user.decorator';
import { Audit }         from '../../common/interceptors/audit.interceptor';

@UseGuards(JwtAuthGuard)
@Controller('analise-credito')
export class AnaliseCreditoController {
  private readonly logger = new Logger(AnaliseCreditoController.name);

  constructor(
    private readonly p01Service:    P01Service,
    private readonly p01Job:        P01Job,
    private readonly p02Service:    P02Service,
    private readonly p03Service:    P03Service,
    private readonly p04Service:    P04Service,
    private readonly ecfDataSource: EcfDataSourceService,
    private readonly prisma:        PrismaService,
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
    this.validarCnpj(cnpj);
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

  // ─── Admin: reset completo P01→P04 ───────────────────────────────────────────

  /**
   * Apaga todos os dados do pipeline P01→P04 para o tenant.
   * Inclui dados brutos ECF/ECD (P01) e todos os outputs calculados (P02→P04).
   * Após o reset, é necessário rodar o pipeline completo novamente.
   */
  @Post('admin/resetar')
  @HttpCode(HttpStatus.OK)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoReset')
  async resetarDadosProcessados(@CurrentUser('tenantId') tenantId: string) {
    const empresas = await this.prisma.creditoEmpresa.findMany({
      where:  { tenantId },
      select: { id: true },
    });
    const ids = empresas.map(e => e.id);
    if (ids.length === 0) return { mensagem: 'Nenhuma empresa encontrada', totais: {} };

    const [
      ecfReg, ecdSaldo, planoConta,
      balanco, dre, estrutura, indicador, alerta, classificacao,
      inconsistencia, processamento,
    ] = await Promise.all([
      // P01 — dados brutos
      this.prisma.creditoEcfRegistro.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoEcdSaldo.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoPlanoConta.deleteMany({ where: { empresaId: { in: ids } } }),
      // P02→P04 — outputs calculados
      this.prisma.creditoBalanco.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoDre.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoEstruturaCapital.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoIndicador.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoAlerta.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoClassificacao.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoInconsistencia.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoProcessamento.deleteMany({ where: { empresaId: { in: ids } } }),
    ]);

    this.logger.warn(
      `[Admin] Reset COMPLETO pelo tenant ${tenantId}: ` +
      `ecf=${ecfReg.count} ecd=${ecdSaldo.count} plano=${planoConta.count} ` +
      `balanco=${balanco.count} dre=${dre.count} indicador=${indicador.count}`,
    );
    return {
      mensagem: 'Reset completo (P01→P04) executado com sucesso',
      totais: {
        ecfRegistros:   ecfReg.count,
        ecdSaldos:      ecdSaldo.count,
        planoContas:    planoConta.count,
        balanco:        balanco.count,
        dre:            dre.count,
        estrutura:      estrutura.count,
        indicadores:    indicador.count,
        alertas:        alerta.count,
        classificacoes: classificacao.count,
        inconsistencias:inconsistencia.count,
        processamentos: processamento.count,
      },
    };
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

  /** Resumo financeiro: DRE principal + Estrutura de Capital para um exercício */
  @Get('empresas/:cnpj/financeiro')
  async financeiro(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
    @Query('exercicio') exercicioStr?: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const exercicio = this.parseExercicio(exercicioStr);
    if (exercicio === undefined) throw new BadRequestException('exercicio é obrigatório');

    const DRE_LINHAS = ['receita_bruta','receita_liquida','ebitda','ebit','lucro_liquido','desp_financeiras','cmv'];

    const [dreRows, estrutura] = await Promise.all([
      this.prisma.creditoDre.findMany({
        where:  { empresaId: empresa.id, exercicio, linhaDre: { in: DRE_LINHAS } },
        select: { linhaDre: true, valor: true },
      }),
      this.prisma.creditoEstruturaCapital.findUnique({
        where: { empresaId_exercicio: { empresaId: empresa.id, exercicio } },
      }),
    ]);

    const dre: Record<string, string | null> = {};
    for (const r of dreRows) dre[r.linhaDre] = r.valor.toString();

    // ── Fallback on-demand: calcula direto do ECF se P02 ainda não rodou ──────
    // Garante que a Receita Líquida e demais KPIs apareçam mesmo antes do P02
    const dreVazio    = dreRows.length === 0;
    const estruturaOk = estrutura !== null;

    const [dreOnDemand, balOnDemand] = await Promise.all([
      dreVazio    ? this.p02Service.calcularDreOnDemand(empresa.id, exercicio, empresa.regimeTributario).catch(() => ({} as Record<string, string | null>)) : Promise.resolve(null),
      !estruturaOk ? this.p02Service.calcularBalancoOnDemand(empresa.id, exercicio, empresa.regimeTributario).catch(() => null) : Promise.resolve(null),
    ]);

    if (dreVazio && dreOnDemand) Object.assign(dre, dreOnDemand);

    const estruturaResp = estrutura
      ? {
          ativoTotal:          estrutura.ativoTotal?.toString()          ?? null,
          passivoTotal:        estrutura.passivoTotal?.toString()        ?? null,
          pl:                  estrutura.pl?.toString()                  ?? null,
          dividaFinanceiraCp:  estrutura.dividaFinanceiraCp?.toString()  ?? null,
          dividaFinanceiraLp:  estrutura.dividaFinanceiraLp?.toString()  ?? null,
          dividaFinanceiraTot: estrutura.dividaFinanceiraTot?.toString() ?? null,
          dividaLiquida:       estrutura.dividaLiquida?.toString()       ?? null,
        }
      : balOnDemand
        ? { ativoTotal: balOnDemand.ativoTotal, pl: balOnDemand.pl,
            passivoTotal: null, dividaFinanceiraCp: null, dividaFinanceiraLp: null,
            dividaFinanceiraTot: null, dividaLiquida: null }
        : null;

    return { exercicio, dre, estrutura: estruturaResp };
  }

  /** Exercícios disponíveis para um CNPJ (ECF ou ECD processados) */
  @Get('empresas/:cnpj/exercicios')
  async exercicios(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const [ecfArqRows, ecfRows, balRows] = await Promise.all([
      this.prisma.creditoEcfArquivo.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
      this.prisma.creditoEcfRegistro.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
      this.prisma.creditoBalanco.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
    ]);

    const anos = new Set([...ecfArqRows, ...ecfRows, ...balRows].map(r => r.exercicio));
    return [...anos].sort((a, b) => b - a);
  }

  /** Balanço Patrimonial ou DRE — ECF primário (regime-aware), fallback ECD via P02 */
  @Get('empresas/:cnpj/demonstracoes')
  async demonstracoes(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
    @Query('tipo') tipo: string,
    @Query('exercicio') exercicioStr?: string,
    @Query('contaRef') contaRef?: string,
    @Query('trimestre') trimestreStr?: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const exercicio = this.parseExercicio(exercicioStr);
    if (exercicio === undefined) throw new BadRequestException('exercicio é obrigatório');

    // trimestre=0 → anual; 1..4 → Q1..Q4; undefined → último disponível
    const trimestreReq = trimestreStr !== undefined ? Number.parseInt(trimestreStr, 10) : undefined;

    // ── Fonte primária: ECF via EcfDataSource (Parquet → fallback DB) ─────────
    // consultarComTrimestres: buffer Parquet escrito em /tmp apenas 1× por candidato
    const candidatos = this.registrosPorRegime(empresa.regimeTributario, tipo === 'dre' ? 'dre' : 'bp');

    const ehBP = tipo !== 'dre';

    for (const registroEcf of candidatos) {
      const resultado = await this.ecfDataSource.consultarComTrimestres(
        empresa.id, exercicio, registroEcf, trimestreReq, contaRef?.trim() || undefined,
      );
      if (!resultado || resultado.registros.length === 0) continue;

      const { trimestres, trimestreAtivo, registros } = resultado;
      const parentCodes = new Set(
        registros.map(r => r.linhaCodigo.split('.').slice(0, -1).join('.')).filter(Boolean),
      );
      return {
        trimestres,
        trimestreAtivo,
        linhas: registros.map(r => ({
          linhaCodigo:     r.linhaCodigo,
          descricao:       r.descricao,
          valor:           new Decimal(r.valor),
          // indCta do ECF tem precedência; fallback pela presença de filhos
          tipo:            r.indCta ?? (parentCodes.has(r.linhaCodigo) ? 'S' : 'A'),
          nivel:           r.nivel ?? r.linhaCodigo.split('.').length,
          haFilhos:        parentCodes.has(r.linhaCodigo),
          natureza:        ehBP
            ? (r.linhaCodigo.startsWith('1') ? 'DEVEDOR' : 'CREDOR')
            : (r.valor >= 0 ? 'CREDOR' : 'DEVEDOR'),
          fonte:           registroEcf.toLowerCase(),
          // Campos de movimentação — extraídos do próprio ECF (campos [7-12])
          saldoAnterior:   r.saldoAnterior !== 0 ? new Decimal(r.saldoAnterior) : null,
          naturezaAnterior: r.naturezaAnterior || null,
          totalDebitos:    r.totalDebitos !== null ? new Decimal(r.totalDebitos) : null,
          totalCreditos:   r.totalCreditos !== null ? new Decimal(r.totalCreditos) : null,
          naturezaFinal:   r.naturezaFinal || null,
        })),
      };
    }

    // ── Fallback: ECD via P02 (creditoBalanco / creditoDre) ───────────────────
    const linhas = tipo === 'dre'
      ? await this.demonstracoesDreFallback(empresa.id, exercicio)
      : await this.demonstracoesBalancoFallback(empresa.id, exercicio, contaRef);
    return { trimestres: [0], trimestreAtivo: 0, linhas };
  }

  /**
   * Retorna os registros ECF de BP ou DRE em ordem de prioridade:
   * primeiro o específico do regime, depois os demais como fallback.
   *
   * Regime          BP     DRE
   * lucro_real      L100   L300
   * lucro_presumido P100   P150
   * lucro_arbitrado P100   P150
   * imune_isenta    U100   U150
   * simples_nacional P100  P150  (DEFIS não tem ECF, mas guardamos P caso haja)
   */
  private registrosPorRegime(regimeTributario: string | null, tipo: 'bp' | 'dre'): string[] {
    const MAPA: Record<string, { bp: string; dre: string }> = {
      lucro_real:       { bp: 'L100', dre: 'L300' },
      lucro_presumido:  { bp: 'P100', dre: 'P150' },
      lucro_arbitrado:  { bp: 'P100', dre: 'P150' },
      imune_isenta:     { bp: 'U100', dre: 'U150' },
      simples_nacional: { bp: 'P100', dre: 'P150' },
    };
    const cfg      = MAPA[regimeTributario ?? ''] ?? MAPA['lucro_real'];
    const primario = cfg[tipo];
    const todos    = tipo === 'bp' ? ['L100', 'P100', 'U100'] : ['L300', 'P150', 'U150'];
    return [primario, ...todos.filter(r => r !== primario)];
  }

  private async demonstracoesBalancoFallback(empresaId: string, exercicio: number, contaRef?: string) {
    const [linhas, periodoMax] = await Promise.all([
      this.prisma.creditoBalanco.findMany({
        where:   { empresaId, exercicio },
        orderBy: [{ grupo: 'asc' }, { subgrupo: 'asc' }, { contaNome: 'asc' }],
        select:  { grupo: true, subgrupo: true, contaCodigo: true, contaNome: true, valor: true, fonte: true },
      }),
      this.prisma.creditoEcdSaldo.findFirst({
        where:   { empresaId, exercicio },
        orderBy: { periodo: 'desc' },
        select:  { periodo: true },
      }),
    ]);

    // Mapa de movimentação por contaCodigo (período final do exercício)
    const movMap = new Map<string, {
      saldoAnterior: Decimal; naturezaAnterior: string | null;
      debitos: Decimal; creditos: Decimal; naturezaFinal: string | null;
    }>();
    if (periodoMax) {
      const saldos = await this.prisma.creditoEcdSaldo.findMany({
        where:  { empresaId, exercicio, periodo: periodoMax.periodo },
        select: { contaCodigo: true, saldoAnterior: true, debitos: true, creditos: true, saldoFinal: true, naturezaSaldo: true },
      });
      for (const s of saldos) {
        movMap.set(s.contaCodigo, {
          saldoAnterior:    s.saldoAnterior,
          naturezaAnterior: s.naturezaSaldo,
          debitos:          s.debitos,
          creditos:         s.creditos,
          naturezaFinal:    s.naturezaSaldo,
        });
      }
    }

    const GRUPO_LABEL: Record<string, string> = {
      AC:  'ATIVO CIRCULANTE',     ANC: 'ATIVO NÃO CIRCULANTE',
      PC:  'PASSIVO CIRCULANTE',   PNC: 'PASSIVO NÃO CIRCULANTE',
      PL:  'PATRIMÔNIO LÍQUIDO',
    };
    const GRUPO_ORDER = ['AC', 'ANC', 'PC', 'PNC', 'PL'];
    const NATUREZA: Record<string, 'DEVEDOR' | 'CREDOR'> = {
      AC: 'DEVEDOR', ANC: 'DEVEDOR', PC: 'CREDOR', PNC: 'CREDOR', PL: 'CREDOR',
    };
    type Row = {
      linhaCodigo: string; descricao: string; valor: unknown;
      nivel: number; haFilhos: boolean; tipo: 'S' | 'A';
      natureza: 'DEVEDOR' | 'CREDOR'; fonte: string;
      saldoAnterior: Decimal | null; naturezaAnterior: string | null;
      totalDebitos: Decimal | null; totalCreditos: Decimal | null;
      naturezaFinal: string | null;
    };
    const grupoRow = (linhaCodigo: string, descricao: string, valor: Decimal, natureza: 'DEVEDOR' | 'CREDOR'): Row => ({
      linhaCodigo, descricao, valor, nivel: linhaCodigo.split('.').length, haFilhos: true,
      tipo: 'S', natureza, fonte: 'p02',
      saldoAnterior: null, naturezaAnterior: null, totalDebitos: null, totalCreditos: null, naturezaFinal: null,
    });
    const rows: Row[] = [];

    const totalAtivo     = linhas.filter(l => ['AC','ANC'].includes(l.grupo)).reduce((s, l) => s.add(l.valor), new Decimal(0));
    const totalPassivoPl = linhas.filter(l => ['PC','PNC','PL'].includes(l.grupo)).reduce((s, l) => s.add(l.valor), new Decimal(0));

    rows.push(grupoRow('1', 'ATIVO',        totalAtivo,     'DEVEDOR'));
    rows.push(grupoRow('2', 'PASSIVO E PL', totalPassivoPl, 'CREDOR'));

    // Grupos e subgrupos
    const byGrupo = new Map<string, typeof linhas>();
    for (const l of linhas) {
      if (!byGrupo.has(l.grupo)) byGrupo.set(l.grupo, []);
      byGrupo.get(l.grupo)!.push(l);
    }

    let gi = 0;
    for (const grupo of GRUPO_ORDER) {
      const grupoLinhas = byGrupo.get(grupo);
      if (!grupoLinhas?.length) continue;
      gi++;
      const grupoTotal = grupoLinhas.reduce((s, l) => s.add(l.valor), new Decimal(0));
      const grupoCode  = ['AC','ANC'].includes(grupo) ? `1.0${gi}` : `2.0${gi - 2}`;
      const nat        = NATUREZA[grupo] ?? 'DEVEDOR';

      rows.push(grupoRow(grupoCode, GRUPO_LABEL[grupo] ?? grupo, grupoTotal, nat));

      const bySubgrupo = new Map<string, typeof linhas>();
      for (const l of grupoLinhas) {
        if (!bySubgrupo.has(l.subgrupo)) bySubgrupo.set(l.subgrupo, []);
        bySubgrupo.get(l.subgrupo)!.push(l);
      }

      let si = 0;
      for (const [subgrupo, subLinhas] of bySubgrupo) {
        si++;
        const subTotal = subLinhas.reduce((s, l) => s.add(l.valor), new Decimal(0));
        const subCode  = `${grupoCode}.${String(si).padStart(2, '0')}`;
        rows.push(grupoRow(subCode, subgrupo, subTotal, nat));

        subLinhas.forEach((l, idx) => {
          const mov = movMap.get(l.contaCodigo) ?? null;
          rows.push({
            linhaCodigo:     `${subCode}.${String(idx + 1).padStart(2, '0')}`,
            descricao:       l.contaNome,
            valor:           l.valor,
            nivel:           4,
            haFilhos:        false,
            tipo:            'A',
            natureza:        nat,
            fonte:           l.fonte,
            saldoAnterior:   mov?.saldoAnterior    ?? null,
            naturezaAnterior: mov?.naturezaAnterior ?? null,
            totalDebitos:    mov?.debitos           ?? null,
            totalCreditos:   mov?.creditos          ?? null,
            naturezaFinal:   mov?.naturezaFinal     ?? null,
          });
        });
      }
    }

    const filtro = contaRef?.trim();
    return filtro ? rows.filter(r => r.linhaCodigo.startsWith(filtro)) : rows;
  }

  private async demonstracoesDreFallback(empresaId: string, exercicio: number) {
    const linhas = await this.prisma.creditoDre.findMany({
      where:  { empresaId, exercicio },
      select: { linhaDre: true, valor: true, fonte: true },
    });
    const dreMap = new Map(linhas.map(l => [l.linhaDre, l]));

    const SECOES = [
      { code: '3.01', label: 'RECEITA',              linhas: ['receita_bruta','deducoes','receita_liquida'] },
      { code: '3.02', label: 'CUSTOS',               linhas: ['cmv','lucro_bruto'] },
      { code: '3.03', label: 'DESPESAS OPERACIONAIS',linhas: ['desp_vendas','desp_admin','outras_desp'] },
      { code: '3.04', label: 'RESULTADO FINANCEIRO', linhas: ['rec_financeiras','desp_financeiras'] },
      { code: '3.05', label: 'IMPOSTOS',             linhas: ['ir_csll'] },
      { code: '3.06', label: 'RESULTADO LÍQUIDO',    linhas: ['lucro_liquido'] },
      { code: '3.07', label: 'EBITDA',               linhas: ['ebit','depreciacao','ebitda'] },
    ];
    const LINHA_LABEL: Record<string, string> = {
      receita_bruta: 'Receita Bruta', deducoes: 'Deduções', receita_liquida: 'Receita Líquida',
      cmv: 'CMV / CPV', lucro_bruto: 'Lucro Bruto',
      desp_vendas: 'Despesas de Vendas', desp_admin: 'Despesas Administrativas', outras_desp: 'Outras Despesas',
      rec_financeiras: 'Receitas Financeiras', desp_financeiras: 'Despesas Financeiras',
      ir_csll: 'IR / CSLL', lucro_liquido: 'Resultado Líquido do Período',
      ebit: 'EBIT', depreciacao: 'Depreciação / Amortização', ebitda: 'EBITDA',
    };

    type Row = { linhaCodigo: string; descricao: string; valor: unknown; nivel: number; haFilhos: boolean; natureza: 'DEVEDOR' | 'CREDOR'; fonte: string };
    const rows: Row[] = [];

    for (const secao of SECOES) {
      const secaoLinhas = secao.linhas.map(k => dreMap.get(k)).filter(Boolean);
      if (!secaoLinhas.length) continue;
      rows.push({ linhaCodigo: secao.code, descricao: secao.label, valor: 0, nivel: 1, haFilhos: true, natureza: 'CREDOR', fonte: 'p02' });
      secaoLinhas.forEach((l, idx) => {
        const v = l!.valor;
        rows.push({
          linhaCodigo: `${secao.code}.${String(idx + 1).padStart(2, '0')}`,
          descricao:   LINHA_LABEL[l!.linhaDre] ?? l!.linhaDre,
          valor:       v,
          nivel:       2,
          haFilhos:    false,
          natureza:    v.greaterThanOrEqualTo(0) ? 'CREDOR' : 'DEVEDOR',
          fonte:       l!.fonte,
        });
      });
    }
    return rows;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private parseExercicio(value?: string): number | undefined {
    if (!value) return undefined;
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) throw new BadRequestException('exercicio deve ser um número inteiro');
    const anoAtual = new Date().getFullYear();
    if (n < 2000 || n > anoAtual + 1)
      throw new BadRequestException(`exercicio deve estar entre 2000 e ${anoAtual + 1}`);
    return n;
  }

  private validarCnpj(cnpj: string): void {
    if (!/^\d{14}$/.test(cnpj))
      throw new BadRequestException('CNPJ deve ter exatamente 14 dígitos numéricos');
  }
}
