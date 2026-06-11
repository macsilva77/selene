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
   * Lista todas as empresas do tenant que possuem arquivos EFD_ICMS_IPI elegíveis
   * (independente de já terem sido processados). Usado pelo frontend para popular o select.
   */
  @Get('empresas')
  async listarEmpresas(@CurrentUser('tenantId') tenantId: string) {
    const todasEmpresas = await this.prisma.empresa.findMany({
      where: { tenantId },
      select: { id: true, cnpj: true, nome: true, nomeFantasia: true },
    });

    if (todasEmpresas.length === 0) return [];

    const cnpjs = todasEmpresas.map(e => e.cnpj);

    const comSped = await this.prisma.obrigacaoAcessoria.findMany({
      where: {
        cnpj:                { in: cnpjs },
        tipoObrigacao:       'EFD_ICMS_IPI',
        statusProcessamento: { in: ['Processado', 'Recebido', 'Erro_Hash_Divergente'] },
        versaoAtual:         true,
      },
      distinct: ['cnpj'],
      select:   { cnpj: true },
    });

    const cnpjsComSped = new Set(comSped.map(c => c.cnpj));

    return todasEmpresas
      .filter(e => cnpjsComSped.has(e.cnpj))
      .map(e => ({ cnpj: e.cnpj, razaoSocial: e.nomeFantasia || e.nome }))
      .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'));
  }

  /**
   * Retorna o status de processamento CF de todas as empresas do tenant.
   * Cada empresa mostra: total de competências EFD disponíveis, quantas já
   * foram processadas e quantas ainda estão pendentes.
   */
  @Get('status-processamento')
  async statusProcessamento(@CurrentUser('tenantId') tenantId: string) {
    const todasEmpresas = await this.prisma.empresa.findMany({
      where: { tenantId },
      select: { id: true, cnpj: true, nome: true, nomeFantasia: true },
    });
    if (todasEmpresas.length === 0) return [];

    const cnpjs = todasEmpresas.map(e => e.cnpj);

    const statusElegiveis = ['Processado', 'Recebido', 'Erro_Hash_Divergente'] as const;

    const [arquivos, processadas] = await Promise.all([
      this.prisma.obrigacaoAcessoria.findMany({
        where: {
          cnpj:                { in: cnpjs },
          tipoObrigacao:       'EFD_ICMS_IPI',
          statusProcessamento: { in: [...statusElegiveis] },
          versaoAtual:         true,
        },
        select: { cnpj: true, dataInicial: true },
      }),
      this.prisma.clientesFornecedoresCompetencia.findMany({
        where:  { tenantId },
        select: { cnpj: true, ano: true, mes: true, status: true, processadoEm: true },
      }),
    ]);

    // Deduplica competências disponíveis por CNPJ+ano+mes
    const disponiveisByCnpj = new Map<string, Set<string>>();
    for (const a of arquivos) {
      const ano = a.dataInicial.getFullYear();
      const mes = a.dataInicial.getMonth() + 1;
      const key = `${ano}-${mes}`;
      if (!disponiveisByCnpj.has(a.cnpj)) disponiveisByCnpj.set(a.cnpj, new Set());
      disponiveisByCnpj.get(a.cnpj)!.add(key);
    }

    // Agrupa processadas por CNPJ
    const processadasByCnpj = new Map<string, { key: string; processadoEm: string | null }[]>();
    for (const p of processadas) {
      if (p.status !== 'PROCESSADO') continue;
      const key = `${p.ano}-${p.mes}`;
      if (!processadasByCnpj.has(p.cnpj)) processadasByCnpj.set(p.cnpj, []);
      processadasByCnpj.get(p.cnpj)!.push({ key, processadoEm: p.processadoEm?.toISOString() ?? null });
    }

    return todasEmpresas
      .filter(e => disponiveisByCnpj.has(e.cnpj))
      .map(e => {
        const disponiveis = disponiveisByCnpj.get(e.cnpj)!;
        const proc        = processadasByCnpj.get(e.cnpj) ?? [];
        const processadasSet = new Set(proc.map(p => p.key));
        const ultimaProcessadoEm = proc
          .map(p => p.processadoEm)
          .filter((a): a is string => a !== null)
          .sort((a, b) => a.localeCompare(b))
          .at(-1) ?? null;
        return {
          cnpj:             e.cnpj,
          razaoSocial:      e.nomeFantasia || e.nome,
          totalDisponivel:  disponiveis.size,
          processadas:      processadasSet.size,
          pendentes:        disponiveis.size - processadasSet.size,
          ultimaAtualizacao: ultimaProcessadoEm,
        };
      })
      .sort((a, b) => b.pendentes - a.pendentes || a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'));
  }

  /**
   * Lista as competências (meses) disponíveis para uma empresa.
   * Fonte primária: arquivos EFD_ICMS_IPI em ObrigacaoAcessoria.
   * Enriquece com qtd/status dos meses já processados em cf_competencias.
   */
  @Get('competencias')
  async competencias(
    @CurrentUser('tenantId') tenantId: string,
    @Query('cnpj') cnpj: string,
  ) {
    if (!cnpj) throw new BadRequestException('cnpj é obrigatório');

    // Garante que o CNPJ pertence ao tenant
    const empresa = await this.prisma.empresa.findFirst({
      where: { tenantId, cnpj },
      select: { id: true },
    });
    if (!empresa) throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada`);

    const [arquivos, processadas] = await Promise.all([
      this.prisma.obrigacaoAcessoria.findMany({
        where: {
          cnpj,
          tipoObrigacao:       'EFD_ICMS_IPI',
          statusProcessamento: { in: ['Processado', 'Recebido', 'Erro_Hash_Divergente'] },
          versaoAtual:         true,
        },
        select:   { dataInicial: true },
        orderBy:  { dataInicial: 'asc' },
      }),
      this.prisma.clientesFornecedoresCompetencia.findMany({
        where:  { tenantId, cnpj },
        select: { ano: true, mes: true, qtdClientes: true, qtdFornecedores: true, status: true, processadoEm: true },
      }),
    ]);

    const processadasMap = new Map(
      processadas.map(p => [`${p.ano}-${p.mes}`, p]),
    );

    const vistos = new Set<string>();
    return arquivos
      .filter(a => {
        const key = `${a.dataInicial.getFullYear()}-${a.dataInicial.getMonth() + 1}`;
        if (vistos.has(key)) return false;
        vistos.add(key);
        return true;
      })
      .map(a => {
        const ano = a.dataInicial.getFullYear();
        const mes = a.dataInicial.getMonth() + 1;
        const p   = processadasMap.get(`${ano}-${mes}`);
        return {
          ano,
          mes,
          qtdClientes:     p?.qtdClientes     ?? 0,
          qtdFornecedores: p?.qtdFornecedores ?? 0,
          status:          p?.status          ?? 'NÃO_PROCESSADO',
          processadoEm:    p?.processadoEm?.toISOString() ?? null,
        };
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
   * Reprocessa SPEDs pendentes (pula os já com status=PROCESSADO em cf_competencias).
   * Processa em batches paralelos de 4 para reduzir o tempo total.
   * Retorna imediatamente HTTP 202; o trabalho ocorre em background.
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

    const statusElegiveis = ['Processado', 'Recebido', 'Erro_Hash_Divergente'];

    const [icmsFiles, jaProcessadas, contribFiles] = await Promise.all([
      this.prisma.obrigacaoAcessoria.findMany({
        where: {
          cnpj:                { in: cnpjs },
          tipoObrigacao:       'EFD_ICMS_IPI',
          statusProcessamento: { in: statusElegiveis },
          versaoAtual:         true,
        },
        select:  { cnpj: true, dataInicial: true, caminhoBucket: true },
        orderBy: { dataInicial: 'asc' },
      }),
      // Busca competências já processadas para skip
      this.prisma.clientesFornecedoresCompetencia.findMany({
        where:  { tenantId, status: 'PROCESSADO' },
        select: { cnpj: true, ano: true, mes: true },
      }),
      this.prisma.obrigacaoAcessoria.findMany({
        where: {
          cnpj:                { in: cnpjs },
          tipoObrigacao:       'EFD_CONTRIBUICOES',
          statusProcessamento: { in: statusElegiveis },
          versaoAtual:         true,
        },
        select: { cnpj: true, dataInicial: true, caminhoBucket: true },
      }),
    ]);

    // Monta set de chaves já processadas para skip O(1)
    const processadasSet = new Set(
      jaProcessadas.map(p => `${p.cnpj}|${p.ano}|${p.mes}`),
    );

    const pendentes = icmsFiles.filter(f => {
      const ano = f.dataInicial.getFullYear();
      const mes = f.dataInicial.getMonth() + 1;
      return !processadasSet.has(`${f.cnpj}|${ano}|${mes}`);
    });

    const ignoradas = icmsFiles.length - pendentes.length;

    this.logger.log(
      `[Reprocessar] tenant=${tenantId} — ${pendentes.length} pendente(s), ` +
      `${ignoradas} já processada(s) ignorada(s)`,
    );

    if (pendentes.length === 0) {
      return {
        mensagem:  'Todas as competências já foram processadas',
        status:    'aceito',
        total:     0,
        ignoradas,
      };
    }

    const contribMap = new Map(
      contribFiles.map(c => [`${c.cnpj}|${c.dataInicial.getTime()}`, c.caminhoBucket]),
    );

    const BATCH_SIZE = 4;

    void (async () => {
      let ok = 0;
      let erros = 0;

      for (let i = 0; i < pendentes.length; i += BATCH_SIZE) {
        const batch = pendentes.slice(i, i + BATCH_SIZE);
        const resultados = await Promise.allSettled(
          batch.map(async (icms) => {
            const empresaId = cnpjToId.get(icms.cnpj);
            if (!empresaId) throw new Error(`empresaId não encontrado para ${icms.cnpj}`);
            const ano = icms.dataInicial.getFullYear();
            const mes = icms.dataInicial.getMonth() + 1;
            await this.processamentoService.processar({
              tenantId,
              empresaId,
              cnpj:              icms.cnpj,
              ano,
              mes,
              spedIcmsIpiGcsUri: icms.caminhoBucket,
              spedContribGcsUri: contribMap.get(`${icms.cnpj}|${icms.dataInicial.getTime()}`),
            });
          }),
        );

        for (const r of resultados) {
          if (r.status === 'fulfilled') ok++;
          else {
            erros++;
            this.logger.warn(
              `[Reprocessar] Erro no batch: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
            );
          }
        }
      }

      this.logger.log(
        `[Reprocessar] tenant=${tenantId} — ${ok}/${pendentes.length} concluída(s), ${erros} erro(s)`,
      );
    })().catch(err =>
      this.logger.error('[Reprocessar] Erro em background', err instanceof Error ? err.stack : String(err)),
    );

    return {
      mensagem:  `Reprocessamento iniciado para ${pendentes.length} competência(s) pendente(s)` +
                 (ignoradas > 0 ? ` — ${ignoradas} já processada(s) ignorada(s)` : ''),
      status:    'aceito',
      total:     pendentes.length,
      ignoradas,
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
   * Tenta primeiro em cf_competencias (fast path); fallback para empresa table.
   * Lança 404 apenas se o CNPJ não existir no tenant.
   */
  private async resolverEmpresaId(tenantId: string, cnpj: string): Promise<string> {
    const comp = await this.prisma.clientesFornecedoresCompetencia.findFirst({
      where: { tenantId, cnpj },
      select: { empresaId: true },
    });
    if (comp) return comp.empresaId;

    const empresa = await this.prisma.empresa.findFirst({
      where: { tenantId, cnpj },
      select: { id: true },
    });
    if (!empresa) {
      throw new NotFoundException(`Empresa CNPJ ${cnpj} não encontrada neste tenant`);
    }
    return empresa.id;
  }
}
