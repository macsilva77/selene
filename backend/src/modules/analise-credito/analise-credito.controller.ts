import {
  Controller, Logger, Post, Get, Patch, Param, Query, Body, Request, UseGuards,
  HttpCode, HttpStatus, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Prisma, AuditAcao } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { DIVIDA_FINANCEIRA_CP, DIVIDA_FINANCEIRA_LP } from './infrastructure/referencial-codigos';
import { P01Service }        from './p01/p01.service';
import { P02DreService }     from './p02/p02-dre.service';
import { P02BalancoService } from './p02/p02-balanco.service';
import { CreditoRegraService, UpdateRegraDto } from './credito-regra.service';
import {
  calcularIndicadores,
  calcularEstruturaCapital,
  type BalData,
  type DreData,
} from './p03/p03-formulas';
import { EcfDataSourceService } from './infrastructure/ecf-data-source.service';
import { AnaliseCreditoCalcularService } from './analise-credito-calcular.service';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard }  from '../../common/guards/jwt-auth.guard';
import { CurrentUser }   from '../../common/decorators/current-user.decorator';
import { Audit }         from '../../common/interceptors/audit.interceptor';

@UseGuards(JwtAuthGuard)
@Controller('analise-credito')
export class AnaliseCreditoController {
  private readonly logger = new Logger(AnaliseCreditoController.name);

  constructor(
    private readonly p01Service:      P01Service,
    private readonly dreService:      P02DreService,
    private readonly balancoService:  P02BalancoService,
    private readonly ecfDataSource:   EcfDataSourceService,
    private readonly calcularService: AnaliseCreditoCalcularService,
    private readonly prisma:          PrismaService,
    private readonly regraService:    CreditoRegraService,
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
    await this.verificarPropriedadeCnpj(tenantId, cnpj);
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

  // ─── Calcular (ECF Parquet → indicadores + DRE + estrutura + alertas) ─────────

  /**
   * Lê o ECF Parquet de todos os exercícios da empresa, calcula indicadores,
   * estrutura de capital e DRE, salva nas tabelas e roda P04 (alertas).
   * Equivale ao antigo P02→P03→P04, mas lendo direto da fonte correta.
   */
  @Post('empresas/:cnpj/calcular')
  @HttpCode(HttpStatus.OK)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoCalcular')
  async calcular(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    this.validarCnpj(cnpj);
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const resultados = await this.calcularService.calcularParaEmpresa(empresa);
    return { cnpj, resultados };
  }

  // ─── Admin: reset completo ────────────────────────────────────────────────────

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
      dre, estrutura, indicador, alerta, classificacao,
      inconsistencia, processamento,
    ] = await Promise.all([
      this.prisma.creditoEcfRegistro.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoEcdSaldo.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoPlanoConta.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoDre.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoEstruturaCapital.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoIndicador.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoAlerta.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoClassificacao.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoInconsistencia.deleteMany({ where: { empresaId: { in: ids } } }),
      this.prisma.creditoProcessamento.deleteMany({ where: { empresaId: { in: ids } } }),
    ]);

    this.logger.warn(`[Admin] Reset pelo tenant ${tenantId}: ecf=${ecfReg.count} dre=${dre.count} indicador=${indicador.count}`);
    return {
      mensagem: 'Reset executado com sucesso',
      totais: {
        ecfRegistros:   ecfReg.count,
        ecdSaldos:      ecdSaldo.count,
        planoContas:    planoConta.count,
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

  // ─── Admin: reprocessar todos os ECFs do tenant ──────────────────────────────

  @Post('admin/reprocessar-ecf')
  @HttpCode(HttpStatus.ACCEPTED)
  @Audit(AuditAcao.STATUS_CHANGE, 'AnaliseCreditoReprocessarEcf')
  async reprocessarEcf(@CurrentUser('tenantId') tenantId: string) {
    // CNPJs do cadastro de empresas do tenant
    const empresas = await this.prisma.empresa.findMany({
      where:  { tenantId },
      select: { cnpj: true },
      distinct: ['cnpj'],
    });

    // CNPJs com ECF processado na tabela de obrigações (sem filtro de tenant — design do módulo)
    const ecfObrigacoes = await this.prisma.obrigacaoAcessoria.findMany({
      where:  { tipoObrigacao: 'ECF', statusProcessamento: 'Processado' },
      select: { cnpj: true },
      distinct: ['cnpj'],
    });

    const cnpjsSet = new Set([
      ...empresas.map(e => e.cnpj),
      ...ecfObrigacoes.map(e => e.cnpj),
    ]);
    const cnpjs = [...cnpjsSet];
    this.logger.log(`[ReprocessarEcf] tenant=${tenantId} — ${cnpjs.length} empresa(s) (${empresas.length} cadastradas + ${ecfObrigacoes.length} ECF-only)`);

    void (async () => {
      for (const cnpj of cnpjs) {
        try {
          await this.p01Service.processarCnpj(tenantId, cnpj);
          const creditoEmp = await this.prisma.creditoEmpresa.findUnique({
            where:  { tenantId_cnpj: { tenantId, cnpj } },
            select: { id: true, cnpj: true, regimeTributario: true },
          });
          if (creditoEmp) await this.calcularService.calcularParaEmpresa(creditoEmp);
        } catch (err) {
          this.logger.warn(`[ReprocessarEcf] ${cnpj}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.logger.log(`[ReprocessarEcf] tenant=${tenantId} — concluído`);
    })().catch(err => this.logger.error('[ReprocessarEcf] Erro em background', err instanceof Error ? err.stack : String(err)));

    return { mensagem: `P01 + calcular iniciado para ${cnpjs.length} empresa(s)`, status: 'aceito', total: cnpjs.length };
  }

  // ─── Leitura para o dashboard ─────────────────────────────────────────────────

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

  @Get('empresas/:cnpj/status')
  async statusPipeline(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const ecfAnos = await this.prisma.creditoEcfRegistro.findMany({
      where:    { empresaId: empresa.id },
      select:   { exercicio: true },
      distinct: ['exercicio'],
    });

    const indicadores = await this.prisma.creditoIndicador.findMany({
      where:    { empresaId: empresa.id },
      select:   { exercicio: true, valor: true },
    });

    const alertas = await this.prisma.creditoClassificacao.findMany({
      where:    { empresaId: empresa.id },
      select:   { exercicio: true },
    });

    const indPorAno = new Map<number, boolean>();
    for (const i of indicadores) {
      if (i.valor !== null) indPorAno.set(i.exercicio, true);
    }
    const alertaAnos = new Set(alertas.map(a => a.exercicio));

    return ecfAnos.map(({ exercicio }) => ({
      exercicio,
      ecfImportado:  true,
      calculado:     indPorAno.has(exercicio),
      comAlertas:    alertaAnos.has(exercicio),
    })).sort((a, b) => b.exercicio - a.exercicio);
  }

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

    const stored = await this.prisma.creditoIndicador.findMany({
      where,
      orderBy: [{ exercicio: 'desc' }, { indicador: 'asc' }],
    });

    // Exercícios com pelo menos um indicador não-null no banco
    const comDados = new Set(stored.filter(i => i.valor !== null).map(i => i.exercicio));

    // Exercícios disponíveis no ECF (Parquet GCS ou legado DB)
    const [ecfArqAnos, ecfRegAnos] = await Promise.all([
      this.prisma.creditoEcfArquivo.findMany({
        where:    { empresaId: empresa.id, ...(exercicio !== undefined ? { exercicio } : {}) },
        select:   { exercicio: true },
        distinct: ['exercicio'],
      }),
      this.prisma.creditoEcfRegistro.findMany({
        where:    { empresaId: empresa.id, ...(exercicio !== undefined ? { exercicio } : {}) },
        select:   { exercicio: true },
        distinct: ['exercicio'],
      }),
    ]);
    const ecfAnosSet = new Set([...ecfArqAnos, ...ecfRegAnos].map(r => r.exercicio));
    const ecfAnos = [...ecfAnosSet].map(exercicio => ({ exercicio }));

    // Para anos sem dados calculados, tenta ECF on-the-fly (não salva — só para visualização imediata)
    const semDados = ecfAnos.map(r => r.exercicio).filter(a => !comDados.has(a));
    if (semDados.length === 0) return stored;

    const semDadosSet = new Set(semDados);
    const onTheFly = await Promise.all(semDados.map(async ano => {
      const [bal, dre] = await Promise.all([
        this.ecfBalData(empresa.id, ano, empresa.regimeTributario),
        this.ecfDreData(empresa.id, ano, empresa.regimeTributario),
      ]);
      if (!bal || !dre) return [];

      const [balAnt, dreAnt] = await Promise.all([
        this.ecfBalData(empresa.id, ano - 1, empresa.regimeTributario),
        this.ecfDreData(empresa.id, ano - 1, empresa.regimeTributario),
      ]);

      return calcularIndicadores(bal, dre, balAnt ?? undefined, dreAnt ?? undefined, 1).map(i => ({
        id:        `ecf_${ano}_${i.indicador}`,
        empresaId: empresa.id,
        exercicio: ano,
        indicador: i.indicador,
        valor:     i.valor?.toString() ?? null,
        unidade:   i.unidade,
        fonteOk:   i.fonteOk,
      }));
    }));

    return [
      ...stored.filter(i => !semDadosSet.has(i.exercicio)),
      ...onTheFly.flat(),
    ];
  }

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

    // Fallback ECF quando calcular ainda não rodou. null-vs-zero (Fase 5): só
    // emite valores se a DRE for CONFIÁVEL (validacaoOk); senão deixa null → UI
    // mostra "—" em vez de R$ 0,00 sintético (que mascara prejuízo como neutro).
    if (dreRows.length === 0) {
      try {
        const dreEcf = await this.dreService.montar(empresa.id, exercicio, empresa.regimeTributario);
        if (dreEcf.validacaoOk) {
          for (const row of dreEcf.linhas) dre[row.linhaDre] = row.valor.toString();
        }
      } catch { /* ECF ausente — mantém dre vazio */ }
    }

    let estruturaEcf: ReturnType<typeof calcularEstruturaCapital> | null = null;
    if (estrutura === null) {
      const [bal, dreMap] = await Promise.all([
        this.ecfBalData(empresa.id, exercicio, empresa.regimeTributario),
        dreRows.length > 0
          ? Promise.resolve((() => { const m: DreData = new Map(); for (const r of dreRows) m.set(r.linhaDre, r.valor); return m; })())
          : this.ecfDreData(empresa.id, exercicio, empresa.regimeTributario),
      ]);
      if (bal && dreMap) estruturaEcf = calcularEstruturaCapital(bal, dreMap);
    }

    const processando = Object.keys(dre).length === 0 && estruturaEcf === null && estrutura === null;

    const d = (v: Decimal | null | undefined) => v?.toString() ?? null;
    const estruturaResp = estrutura
      ? {
          ativoTotal:          d(estrutura.ativoTotal),
          passivoTotal:        d(estrutura.passivoTotal),
          pl:                  d(estrutura.pl),
          dividaFinanceiraCp:  d(estrutura.dividaFinanceiraCp),
          dividaFinanceiraLp:  d(estrutura.dividaFinanceiraLp),
          dividaFinanceiraTot: d(estrutura.dividaFinanceiraTot),
          dividaLiquida:       d(estrutura.dividaLiquida),
        }
      : estruturaEcf !== null
        ? {
            ativoTotal:          d(estruturaEcf.ativoTotal),
            passivoTotal:        d(estruturaEcf.passivoTotal),
            pl:                  d(estruturaEcf.pl),
            dividaFinanceiraCp:  d(estruturaEcf.dividaFinanceiraCp),
            dividaFinanceiraLp:  d(estruturaEcf.dividaFinanceiraLp),
            dividaFinanceiraTot: d(estruturaEcf.dividaFinanceiraTot),
            dividaLiquida:       d(estruturaEcf.dividaLiquida),
          }
        : null;

    return { exercicio, dre, estrutura: estruturaResp, processando };
  }

  @Get('empresas/:cnpj/kpis-anuais')
  async kpisAnuais(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    // Descobre exercícios (Parquet GCS + legado DB)
    const [arqKpi, regKpi] = await Promise.all([
      this.prisma.creditoEcfArquivo.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
      this.prisma.creditoEcfRegistro.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
    ]);
    const kpiAnosSet = new Set([...arqKpi, ...regKpi].map(r => r.exercicio));
    const exercicios = [...kpiAnosSet].sort((a, b) => b - a);
    if (exercicios.length === 0) return [];

    const DRE_LINHAS = ['receita_liquida', 'ebitda', 'lucro_liquido'];

    const [dresPipeline, estruturasPipeline] = await Promise.all([
      this.prisma.creditoDre.findMany({
        where:  { empresaId: empresa.id, exercicio: { in: exercicios }, linhaDre: { in: DRE_LINHAS } },
        select: { exercicio: true, linhaDre: true, valor: true },
      }),
      this.prisma.creditoEstruturaCapital.findMany({
        where:  { empresaId: empresa.id, exercicio: { in: exercicios } },
        select: { exercicio: true, pl: true, dividaFinanceiraTot: true },
      }),
    ]);

    const dreMap = new Map<number, Map<string, string>>();
    for (const r of dresPipeline) {
      if (!dreMap.has(r.exercicio)) dreMap.set(r.exercicio, new Map());
      dreMap.get(r.exercicio)!.set(r.linhaDre, r.valor.toString());
    }
    const plMap    = new Map<number, string>();
    const dividaMap = new Map<number, string>();
    for (const e of estruturasPipeline) {
      if (e.pl != null)                 plMap.set(e.exercicio, e.pl.toString());
      if (e.dividaFinanceiraTot != null) dividaMap.set(e.exercicio, e.dividaFinanceiraTot.toString());
    }

    const resultado = await Promise.all(exercicios.map(async ano => {
      const drePipe = dreMap.get(ano);

      let receitaLiquida:    string | null = drePipe?.get('receita_liquida') ?? null;
      let ebitda:            string | null = drePipe?.get('ebitda')          ?? null;
      let lucroLiquido:      string | null = drePipe?.get('lucro_liquido')   ?? null;
      let pl:                string | null = plMap.get(ano)                  ?? null;
      let dividaFinanceira:  string | null = dividaMap.get(ano)              ?? null;

      // Fallback ECF quando calcular ainda não rodou. null-vs-zero (Fase 5): só
      // emite se a DRE for confiável (validacaoOk); senão mantém null → UI "—".
      if (!drePipe || drePipe.size === 0) {
        try {
          const dreEcf = await this.dreService.montar(empresa.id, ano, empresa.regimeTributario);
          if (dreEcf.validacaoOk) {
            for (const row of dreEcf.linhas) {
              if (row.linhaDre === 'receita_liquida') receitaLiquida = row.valor.toString();
              if (row.linhaDre === 'ebitda')          ebitda         = row.valor.toString();
              if (row.linhaDre === 'lucro_liquido')   lucroLiquido   = row.valor.toString();
            }
          }
        } catch { /* ECF ausente */ }
      }
      if (pl === null || dividaFinanceira === null) {
        try {
          const bal = await this.ecfBalData(empresa.id, ano, empresa.regimeTributario);
          if (bal) {
            if (pl === null) {
              const plTotal = [...(bal.get('PL')?.values() ?? [])].reduce((s, v) => s.add(v), new Decimal(0));
              if (plTotal.gt(0)) pl = plTotal.toString();
            }
            if (dividaFinanceira === null) {
              const empCP = bal.get('PC')?.get('Empréstimos CP') ?? new Decimal(0);
              const empLP = bal.get('PNC')?.get('Empréstimos LP') ?? new Decimal(0);
              const tot   = empCP.add(empLP);
              if (tot.gt(0)) dividaFinanceira = tot.toString();
            }
          }
        } catch { /* ECF ausente */ }
      }

      return { exercicio: ano, receitaLiquida, ebitda, lucroLiquido, pl, dividaFinanceira };
    }));

    return resultado;
  }

  @Get('empresas/:cnpj/exercicios')
  async exercicios(
    @CurrentUser('tenantId') tenantId: string,
    @Param('cnpj') cnpj: string,
  ) {
    const empresa = await this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const [ecfArqRows, ecfRows, dreRows] = await Promise.all([
      this.prisma.creditoEcfArquivo.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
      this.prisma.creditoEcfRegistro.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
      this.prisma.creditoDre.findMany({
        where: { empresaId: empresa.id }, select: { exercicio: true }, distinct: ['exercicio'],
      }),
    ]);

    const anos = new Set([...ecfArqRows, ...ecfRows, ...dreRows].map(r => r.exercicio));
    return [...anos].sort((a, b) => b - a);
  }

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

    const trimestreReq = trimestreStr !== undefined ? Number.parseInt(trimestreStr, 10) : undefined;
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
          linhaCodigo:      r.linhaCodigo,
          descricao:        r.descricao,
          valor:            new Decimal(r.valor),
          tipo:             r.indCta ?? (parentCodes.has(r.linhaCodigo) ? 'S' : 'A'),
          nivel:            r.nivel ?? r.linhaCodigo.split('.').length,
          haFilhos:         parentCodes.has(r.linhaCodigo),
          natureza:         ehBP
            ? (r.linhaCodigo.startsWith('1') ? 'DEVEDOR' : 'CREDOR')
            : (r.valor >= 0 ? 'CREDOR' : 'DEVEDOR'),
          fonte:            registroEcf.toLowerCase(),
          saldoAnterior:    r.saldoAnterior !== 0 ? new Decimal(r.saldoAnterior) : null,
          naturezaAnterior: r.naturezaAnterior || null,
          totalDebitos:     r.totalDebitos !== null ? new Decimal(r.totalDebitos) : null,
          totalCreditos:    r.totalCreditos !== null ? new Decimal(r.totalCreditos) : null,
          naturezaFinal:    r.naturezaFinal || null,
        })),
      };
    }

    // Fallback ECD via creditoDre / creditoBalanco (legado)
    const linhas = tipo === 'dre'
      ? await this.demonstracoesDreFallback(empresa.id, exercicio)
      : await this.demonstracoesBalancoFallback(empresa.id, exercicio, contaRef);
    return { trimestres: [0], trimestreAtivo: 0, linhas };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────────

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
            linhaCodigo:      `${subCode}.${String(idx + 1).padStart(2, '0')}`,
            descricao:        l.contaNome,
            valor:            l.valor,
            nivel:            4,
            haFilhos:         false,
            tipo:             'A',
            natureza:         nat,
            fonte:            l.fonte,
            saldoAnterior:    mov?.saldoAnterior    ?? null,
            naturezaAnterior: mov?.naturezaAnterior ?? null,
            totalDebitos:     mov?.debitos          ?? null,
            totalCreditos:    mov?.creditos         ?? null,
            naturezaFinal:    mov?.naturezaFinal    ?? null,
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
      { code: '3.01', label: 'RECEITA',               linhas: ['receita_bruta','deducoes','receita_liquida'] },
      { code: '3.02', label: 'CUSTOS',                linhas: ['cmv','lucro_bruto'] },
      { code: '3.03', label: 'DESPESAS OPERACIONAIS', linhas: ['desp_vendas','desp_admin','outras_desp'] },
      { code: '3.04', label: 'RESULTADO FINANCEIRO',  linhas: ['rec_financeiras','desp_financeiras'] },
      { code: '3.05', label: 'IMPOSTOS',              linhas: ['ir_csll'] },
      { code: '3.06', label: 'RESULTADO LÍQUIDO',     linhas: ['lucro_liquido'] },
      { code: '3.07', label: 'EBITDA',                linhas: ['ebit','depreciacao','ebitda'] },
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
      rows.push({ linhaCodigo: secao.code, descricao: secao.label, valor: 0, nivel: 1, haFilhos: true, natureza: 'CREDOR', fonte: 'ecf' });
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

  private async verificarPropriedadeCnpj(tenantId: string, cnpj: string): Promise<void> {
    const existe = await this.prisma.creditoEmpresa.findUnique({
      where:  { tenantId_cnpj: { tenantId, cnpj } },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException(`CNPJ ${cnpj} não encontrado para este tenant`);
  }

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

  // ─── Leitura ECF Parquet → BalData / DreData ──────────────────────────────────

  /**
   * Usa consultarComTrimestres (mesma chamada da página Demonstrações) para garantir
   * que os dados do trimestre correto são lidos numa única conexão DuckDB.
   *
   * getAbs() e getPLSigned() usam 2 estratégias:
   *   1. Nó exato (código == prefix) com valor ≠ 0
   *   2. Soma algébrica das folhas (nós sem filhos) sob o prefixo
   *
   * valorComSinal() no parser armazena débito→positivo e crédito→negativo.
   * Para ativo/passivo usa-se abs() do resultado (sempre positivos em balanço).
   * Para PL usa-se negated(): crédito-dominante → PL positivo (empresa solvente);
   * débito-dominante (prejuízos > capital) → PL negativo (empresa insolvente).
   * A soma algébrica já cancela contas-contra (provisões, depreciação, prejuízos).
   */
  private async ecfBalData(empresaId: string, exercicio: number, regime: string | null): Promise<BalData | null> {
    const candidatos = this.registrosPorRegime(regime, 'bp');
    for (const registroEcf of candidatos) {
      try {
        const resultado = await this.ecfDataSource.consultarComTrimestres(
          empresaId, exercicio, registroEcf,
        );
        if (!resultado || resultado.registros.length === 0) continue;

        const rows = resultado.registros;

        // Códigos que têm filhos (são nós sintéticos)
        const codigosComFilhos = new Set(
          rows.map(r => r.linhaCodigo.split('.').slice(0, -1).join('.')).filter(Boolean),
        );

        const leafSum = (prefix: string): Decimal =>
          rows
            .filter(r => r.linhaCodigo.startsWith(`${prefix}.`) && !codigosComFilhos.has(r.linhaCodigo))
            .reduce((s, r) => s.add(new Decimal(r.valor)), new Decimal(0));

        // Ativo e passivo: sempre positivos → abs() da soma algébrica.
        const getAbs = (prefix: string): Decimal => {
          const exact = rows.find(r => r.linhaCodigo === prefix);
          if (exact) {
            const v = new Decimal(exact.valor).abs();
            if (v.greaterThan(0)) return v;
          }
          return leafSum(prefix).abs();
        };

        // PL com sinal: empresa solvente → positivo; insolvente → negativo.
        // valorComSinal grava crédito como negativo, então basta negar a soma.
        const getPLSigned = (): Decimal => {
          const exact = rows.find(r => r.linhaCodigo === '2.03');
          if (exact && !new Decimal(exact.valor).isZero()) {
            return new Decimal(exact.valor).negated();
          }
          return leafSum('2.03').negated();
        };

        const acTot  = getAbs('1.01');
        const ancTot = getAbs('1.02');
        const pcTot  = getAbs('2.01');
        const pncTot = getAbs('2.02');
        const plVal  = getPLSigned();
        if (acTot.isZero() && plVal.isZero()) continue;

        const caixa    = getAbs('1.01.01');
        const clientes = getAbs('1.01.02');
        const estoques = getAbs('1.01.03');
        const acOutros = Decimal.max(0, acTot.minus(caixa).minus(clientes).minus(estoques));

        const rlp       = getAbs('1.02.01');
        const ancOutros = Decimal.max(0, ancTot.minus(rlp));

        // Dívida financeira por código referencial (Fase 3): CP=2.01.01.07, LP=2.02.01.01.
        const somaCod = (codigos: readonly string[]): Decimal =>
          codigos.reduce((s, c) => s.add(getAbs(c)), new Decimal(0));

        const fornec   = getAbs('2.01.01.01');
        const empCP    = Decimal.min(somaCod(DIVIDA_FINANCEIRA_CP), pcTot);
        const pcOutros = Decimal.max(0, pcTot.minus(fornec).minus(empCP));

        const empLP     = Decimal.min(somaCod(DIVIDA_FINANCEIRA_LP), pncTot);
        const pncOutros = Decimal.max(0, pncTot.minus(empLP));

        const bal: BalData = new Map();
        const set = (g: string, s: string, v: Decimal, allowNegative = false) => {
          if (allowNegative ? v.isZero() : !v.greaterThan(0)) return;
          if (!bal.has(g)) bal.set(g, new Map());
          bal.get(g)!.set(s, (bal.get(g)!.get(s) ?? new Decimal(0)).add(v));
        };

        set('AC',  'Caixa e Equivalentes', caixa);
        set('AC',  'Contas a Receber',     clientes);
        set('AC',  'Estoques',             estoques);
        set('AC',  'Outros',               acOutros);
        set('ANC', 'RLP',                  rlp);
        set('ANC', 'Outros',               ancOutros);
        set('PC',  'Fornecedores',         fornec);
        set('PC',  'Empréstimos CP',       empCP);
        set('PC',  'Outros',               pcOutros);
        set('PNC', 'Empréstimos LP',       empLP);
        set('PNC', 'Outros',               pncOutros);
        set('PL',  'Total',                plVal, true);  // permite negativo (insolvente)

        return bal;
      } catch { continue; }
    }
    return null;
  }

  /**
   * Monta a DRE ANUAL do exercício. dreService.montar (sem trimestre) agrega os
   * blocos trimestrais disjuntos (Σ Q1..Q4) — ler só Q4 subestimava ~4×.
   */
  private async ecfDreData(empresaId: string, exercicio: number, regime: string | null): Promise<DreData | null> {
    const candidatos = this.registrosPorRegime(regime, 'dre');
    for (const registroEcf of candidatos) {
      try {
        const resultado = await this.ecfDataSource.consultarComTrimestres(
          empresaId, exercicio, registroEcf,
        );
        if (!resultado || resultado.registros.length === 0) continue;

        const res = await this.dreService.montar(empresaId, exercicio, regime);
        if (res.linhas.length === 0) continue;

        const dre: DreData = new Map();
        for (const row of res.linhas) dre.set(row.linhaDre, row.valor);
        return dre;
      } catch { continue; }
    }
    return null;
  }

  // ─── Regras de Crédito (manutenção) ──────────────────────────────────────────

  @Get('regras')
  async listarRegras() {
    return this.regraService.findAll();
  }

  @Patch('regras/:id')
  async atualizarRegra(
    @Param('id') id: string,
    @Body() dto: UpdateRegraDto,
    @CurrentUser('sub') usuarioId: string,
    @Request() req: { ip: string },
  ) {
    return this.regraService.update({ usuarioId, ipOrigem: req.ip }, id, dto);
  }

  @Patch('regras/:id/toggle')
  async toggleRegra(
    @Param('id') id: string,
    @CurrentUser('sub') usuarioId: string,
    @Request() req: { ip: string },
  ) {
    return this.regraService.toggleAtivo({ usuarioId, ipOrigem: req.ip }, id);
  }
}
