import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../../database/prisma.service';
import { P01GcsService, GcsArquivoMeta } from './p01-gcs.service';
import { EcfParquetWriter }   from './p01-ecf-parquet.writer';
import { ParquetCacheService } from '../infrastructure/cache/parquet-cache.service';
import { parseEcd }           from './p01-ecd.parser';
import { parseEcf }           from './p01-ecf.parser';
import { Decimal }            from '@prisma/client/runtime/library';
import { withRetry }          from '../shared/with-retry';

const VERSAO_PROMPT = 'P01-v5'; // incrementado após migração para Parquet

interface ExercicioCtx {
  tenantId:  string;
  cnpj:      string;
  exercicio: number;
  empresaId: string;
}

interface Inconsistencia {
  tipoErro:   string;
  descricao:  string;
  severidade: string;
}

export interface P01ProcessarOpcoes {
  forcarReprocessamento?: boolean;
}

export interface P01Resultado {
  cnpj:      string;
  exercicio: number;
  status:    'ok' | 'bloqueado' | 'pulado' | 'erro';
  tabelas:   Record<string, { total: number; ok: number; alerta: number; bloqueados: number }>;
  mensagem?: string;
}

@Injectable()
export class P01Service {
  private readonly logger = new Logger(P01Service.name);

  constructor(
    private readonly prisma:         PrismaService,
    private readonly gcs:            P01GcsService,
    private readonly parquetWriter:  EcfParquetWriter,
    private readonly parquetCache:   ParquetCacheService,
  ) {}

  // ─── API pública ───────────────────────────────────────────────────────────

  /**
   * Processa todos os CNPJs em paralelo.
   * Promise.all garante que todos os exercícios de CNPJs distintos rodem ao mesmo tempo;
   * dentro de cada CNPJ os exercícios ainda são sequenciais (dependência de dados).
   */
  async processarTodos(tenantId: string, opcoes?: P01ProcessarOpcoes): Promise<P01Resultado[]> {
    const cnpjs = await this.gcs.listarCnpjs();
    this.logger.log(`[P01] ${cnpjs.length} CNPJs encontrados — processando em paralelo`);

    const grupos = await Promise.all(
      cnpjs.map(cnpj => this.processarCnpj(tenantId, cnpj, opcoes)),
    );
    return grupos.flat();
  }

  async processarCnpj(
    tenantId: string,
    cnpj:     string,
    opcoes?:  P01ProcessarOpcoes,
  ): Promise<P01Resultado[]> {
    const arquivos = await this.gcs.listarArquivos(cnpj);
    const porAno   = this.gcs.selecionarArquivosPorExercicio(cnpj, arquivos);
    const resultados: P01Resultado[] = [];

    for (const [exercicio, { ecf, ecds }] of porAno) {
      try {
        const res = await this.processarExercicio(tenantId, cnpj, exercicio, ecf, ecds, opcoes);
        resultados.push(res);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[P01] Erro em ${cnpj}/${exercicio}: ${msg}`, err instanceof Error ? err.stack : undefined);
        resultados.push({ cnpj, exercicio, status: 'erro', tabelas: {}, mensagem: msg });
      }
    }
    return resultados;
  }

  // ─── Core ──────────────────────────────────────────────────────────────────

  private async processarExercicio(
    tenantId:    string,
    cnpj:        string,
    exercicio:   number,
    ecfArquivo:  GcsArquivoMeta | undefined,
    ecdArquivos: GcsArquivoMeta[],
    opcoes?:     P01ProcessarOpcoes,
  ): Promise<P01Resultado> {
    const t0 = Date.now();
    this.logger.log(`[P01] ${cnpj}/${exercicio} iniciando`);

    const empresa = await this.upsertEmpresa(tenantId, cnpj, '');

    if (!opcoes?.forcarReprocessamento && await this.verificarIdempotencia(empresa.id, exercicio)) {
      this.logger.log(`[P01] ${cnpj}/${exercicio} já processado — pulando`);
      return { cnpj, exercicio, status: 'pulado', tabelas: {} };
    }

    const resultado: P01Resultado = { cnpj, exercicio, status: 'ok', tabelas: {} };
    const incs: Inconsistencia[] = [];

    const ctx: ExercicioCtx = { tenantId, cnpj, exercicio, empresaId: empresa.id };

    // ECF e ECD podem rodar em paralelo — arquivos independentes
    await Promise.all([
      this.processarEcf(ctx, ecfArquivo, resultado, incs, t0),
      this.processarEcd(ctx, ecdArquivos, resultado, incs, t0),
    ]);

    if (incs.length > 0) {
      await this.prisma.creditoInconsistencia.createMany({
        data: incs.map(i => ({ empresaId: empresa.id, exercicio, ...i })),
      });
    }

    if (incs.some(i => i.severidade === 'bloqueio')) resultado.status = 'bloqueado';
    this.logger.log(`[P01] ${cnpj}/${exercicio} concluído em ${Date.now() - t0}ms — ${resultado.status}`);
    return resultado;
  }

  // ─── ECF → Parquet ─────────────────────────────────────────────────────────

  private async processarEcf(
    ctx:       ExercicioCtx,
    arquivo:   GcsArquivoMeta | undefined,
    resultado: P01Resultado,
    incs:      Inconsistencia[],
    t0:        number,
  ) {
    const { tenantId, cnpj, exercicio, empresaId } = ctx;
    if (!arquivo) {
      incs.push({ tipoErro: 'ECF_AUSENTE', descricao: `Nenhum ECF para ${cnpj}/${exercicio}`, severidade: 'alerta' });
      return;
    }

    try {
      // 1. Download com retry (resiliência a falhas transitórias de rede)
      const { buffer, hash } = await withRetry(
        () => this.gcs.download(arquivo.gcsPath),
        { label: `GCS download ECF ${cnpj}/${exercicio}`, maxAttempts: 3, baseDelayMs: 500 },
      );

      // 2. Parse do arquivo .txt ECF (rápido — operação em memória)
      const ecfResult = parseEcf(buffer);

      // 3. Validação de CNPJ
      if (ecfResult.cnpjArquivo && ecfResult.cnpjArquivo !== cnpj) {
        incs.push({
          tipoErro: 'CNPJ_DIVERGENTE_ECF',
          descricao: `ECF contém CNPJ ${ecfResult.cnpjArquivo} mas a pasta é ${cnpj}`,
          severidade: 'bloqueio',
        });
        resultado.tabelas['tb_ecf_registros'] = { total: 0, ok: 0, alerta: 0, bloqueados: 1 };
        await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_ecf_registros',
          total: 0, ok: 0, alerta: 0, bloqueados: 1, hash, duracaoMs: Date.now() - t0 });
        return;
      }

      // 4. Atualiza empresa com regime tributário extraído do arquivo
      if (ecfResult.razaoSocial || ecfResult.regimeTributario)
        await this.upsertEmpresa(tenantId, cnpj, ecfResult.razaoSocial, ecfResult.regimeTributario);

      // 5. Converte para Parquet (DuckDB Appender — bulk insert, sem SQL por linha)
      const parquetBuffer = await this.parquetWriter.escrever(ecfResult.registros);

      // 6. Upload do Parquet para GCS com retry
      const parquetPath = `ECF/${cnpj}/parquet/${exercicio}.parquet`;
      await withRetry(
        () => this.gcs.upload(parquetPath, parquetBuffer),
        { label: `GCS upload Parquet ${cnpj}/${exercicio}`, maxAttempts: 3, baseDelayMs: 1000 },
      );

      // 7. Invalida cache para forçar leitura do novo arquivo
      this.parquetCache.invalidate(parquetPath);

      // 8. Salva apenas metadados no banco (rápido — 1 row)
      const trimestres = [...new Set(ecfResult.registros.map(r => r.trimestre))].sort((a, b) => a - b);
      await this.salvarMetadataEcf(empresaId, exercicio, parquetPath, arquivo.gcsPath, trimestres, ecfResult.registros.length, hash);

      const alertas = ecfResult.inconsistencias.filter(i => i.severidade === 'alerta').length;
      incs.push(...ecfResult.inconsistencias);
      const total = ecfResult.registros.length;
      resultado.tabelas['tb_ecf_registros'] = { total, ok: total - alertas, alerta: alertas, bloqueados: 0 };
      await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_ecf_registros',
        total, ok: total - alertas, alerta: alertas, bloqueados: 0, hash, duracaoMs: Date.now() - t0 });

      this.logger.log(`[P01] ${cnpj}/${exercicio} ECF: ${total} registros → Parquet ${parquetPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[P01] ${cnpj}/${exercicio} ECF erro: ${msg}`, err instanceof Error ? err.stack : undefined);
      incs.push({ tipoErro: 'ERRO_ECF', descricao: msg, severidade: 'bloqueio' });
      resultado.tabelas['tb_ecf_registros'] = { total: 0, ok: 0, alerta: 0, bloqueados: 1 };
      await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_ecf_registros',
        total: 0, ok: 0, alerta: 0, bloqueados: 1, hash: null, duracaoMs: Date.now() - t0 });
    }
  }

  // ─── ECD ──────────────────────────────────────────────────────────────────

  private async processarEcd(
    ctx:       ExercicioCtx,
    arquivos:  GcsArquivoMeta[],
    resultado: P01Resultado,
    incs:      Inconsistencia[],
    t0:        number,
  ) {
    const { tenantId, cnpj, exercicio, empresaId } = ctx;
    if (arquivos.length === 0) {
      incs.push({ tipoErro: 'ECD_AUSENTE', descricao: `Nenhum ECD para ${cnpj}/${exercicio}`, severidade: 'alerta' });
      return;
    }
    try {
      const planoMerged = new Map<string, ReturnType<typeof parseEcd>['planoContas'][0]>();
      const saldosMerged: ReturnType<typeof parseEcd>['saldos'] = [];
      const hashes: string[] = [];

      for (const arq of arquivos) {
        const { buffer, hash } = await withRetry(
          () => this.gcs.download(arq.gcsPath),
          { label: `GCS download ECD ${cnpj}/${exercicio}`, maxAttempts: 3, baseDelayMs: 500 },
        );
        hashes.push(hash);
        const r = parseEcd(buffer);
        if (r.razaoSocial) await this.upsertEmpresa(tenantId, cnpj, r.razaoSocial);
        for (const p of r.planoContas) planoMerged.set(p.contaCodigo, p);
        saldosMerged.push(...r.saldos);
        incs.push(...r.inconsistencias);
      }

      const hashCombinado = hashes.join('|');
      const planoRows = [...planoMerged.values()];
      await this.upsertPlanoContas(empresaId, exercicio, planoRows);
      await this.upsertEcdSaldos(empresaId, exercicio, saldosMerged);

      const alertas = incs.filter(i => i.severidade === 'alerta').length;
      resultado.tabelas['tb_plano_contas'] = { total: planoRows.length, ok: planoRows.length, alerta: 0, bloqueados: 0 };
      resultado.tabelas['tb_ecd_saldos']   = { total: saldosMerged.length, ok: saldosMerged.length - alertas, alerta: alertas, bloqueados: 0 };

      await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_plano_contas',
        total: planoRows.length, ok: planoRows.length, alerta: 0, bloqueados: 0,
        hash: hashCombinado, duracaoMs: Date.now() - t0 });
      await this.gravarProcessamento({ empresaId, exercicio, tabela: 'tb_ecd_saldos',
        total: saldosMerged.length, ok: saldosMerged.length - alertas, alerta: alertas, bloqueados: 0,
        hash: hashCombinado, duracaoMs: Date.now() - t0 });

      this.logger.log(`[P01] ${cnpj}/${exercicio} ECD: ${saldosMerged.length} saldos | ${planoRows.length} contas`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[P01] ${cnpj}/${exercicio} ECD erro: ${msg}`, err instanceof Error ? err.stack : undefined);
      incs.push({ tipoErro: 'ERRO_ECD', descricao: msg, severidade: 'alerta' });
    }
  }

  // ─── Helpers de DB ─────────────────────────────────────────────────────────

  private async upsertEmpresa(
    tenantId:          string,
    cnpj:              string,
    razaoSocial:       string,
    regimeTributario?: string | null,
  ) {
    const update: Record<string, string> = {};
    if (razaoSocial)      update['razaoSocial']      = razaoSocial;
    if (regimeTributario) update['regimeTributario']  = regimeTributario;
    return this.prisma.creditoEmpresa.upsert({
      where:  { tenantId_cnpj: { tenantId, cnpj } },
      create: { tenantId, cnpj, razaoSocial: razaoSocial || `CNPJ_${cnpj}`, regimeTributario },
      update,
    });
  }

  private async verificarIdempotencia(empresaId: string, exercicio: number): Promise<boolean> {
    const registros = await this.prisma.creditoProcessamento.findMany({
      where: { empresaId, exercicio, versaoPrompt: VERSAO_PROMPT, registrosBloqueados: 0 },
    });
    return registros.some(r =>
      ['tb_ecf_registros', 'tb_ecd_saldos'].includes(r.tabelaDestino) &&
      r.registrosBloqueados === 0
    );
  }

  private async salvarMetadataEcf(
    empresaId:   string,
    exercicio:   number,
    gcsPath:     string,
    gcsPathEcf:  string,
    trimestres:  number[],
    registros:   number,
    hashMd5:     string,
  ) {
    await this.prisma.creditoEcfArquivo.upsert({
      where:  { empresaId_exercicio: { empresaId, exercicio } },
      create: { empresaId, exercicio, gcsPath, gcsPathEcf, trimestres, registros, hashMd5 },
      update: { gcsPath, gcsPathEcf, trimestres, registros, hashMd5 },
    });
  }

  private async upsertPlanoContas(
    empresaId: string,
    exercicio: number,
    rows: ReturnType<typeof parseEcd>['planoContas'],
  ) {
    await this.prisma.$transaction(async tx => {
      await tx.creditoPlanoConta.deleteMany({ where: { empresaId, exercicio } });
      if (rows.length > 0) {
        await tx.creditoPlanoConta.createMany({
          data: rows.map(r => ({ empresaId, exercicio, ...r })),
        });
      }
    }, { timeout: 30000 });
  }

  private async upsertEcdSaldos(
    empresaId: string,
    exercicio: number,
    rows: ReturnType<typeof parseEcd>['saldos'],
  ) {
    await this.prisma.$transaction(async tx => {
      await tx.creditoEcdSaldo.deleteMany({ where: { empresaId, exercicio } });
      if (rows.length > 0) {
        await tx.creditoEcdSaldo.createMany({
          data: rows.map(r => ({
            empresaId, exercicio,
            periodo:       r.periodo,
            contaCodigo:   r.contaCodigo,
            contaNome:     r.contaNome,
            grupo:         r.grupo,
            saldoAnterior: new Decimal(r.saldoAnterior),
            debitos:       new Decimal(r.debitos),
            creditos:      new Decimal(r.creditos),
            saldoFinal:    new Decimal(r.saldoFinal),
            naturezaSaldo: r.naturezaSaldo,
            status:        r.status,
          })),
        });
      }
    }, { timeout: 30000 });
  }

  private async gravarProcessamento(p: {
    empresaId:  string;
    exercicio:  number;
    tabela:     string;
    total:      number;
    ok:         number;
    alerta:     number;
    bloqueados: number;
    hash:       string | null;
    duracaoMs:  number;
  }) {
    const { empresaId, exercicio, tabela: tabelaDestino,
            total, ok, alerta, bloqueados, hash, duracaoMs } = p;
    await this.prisma.creditoProcessamento.upsert({
      where: {
        empresaId_exercicio_tabelaDestino_versaoPrompt: {
          empresaId, exercicio, tabelaDestino, versaoPrompt: VERSAO_PROMPT,
        },
      },
      create: {
        empresaId, exercicio, tabelaDestino,
        totalRegistros:         total,
        registrosOk:            ok,
        registrosComAlerta:     alerta,
        registrosBloqueados:    bloqueados,
        hashArquivoOrigem:      hash,
        timestampProcessamento: new Date(),
        versaoPrompt:           VERSAO_PROMPT,
        duracaoMs,
      },
      update: {
        totalRegistros:         total,
        registrosOk:            ok,
        registrosComAlerta:     alerta,
        registrosBloqueados:    bloqueados,
        hashArquivoOrigem:      hash,
        timestampProcessamento: new Date(),
        duracaoMs,
      },
    });
  }

  async statusPorCnpj(tenantId: string, cnpj: string) {
    return this.prisma.creditoEmpresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
      include: {
        processamentos:  { orderBy: { exercicio: 'desc' } },
        inconsistencias: { orderBy: { criadoEm: 'desc' }, take: 20 },
      },
    });
  }
}
