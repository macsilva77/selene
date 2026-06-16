import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { FaturamentoGcsService } from './faturamento-gcs.service';
import { parseEfdIcmsIpiFaturamento } from './sped/efd-icms-ipi-faturamento.parser';
import { parseEfdContribuicoesFaturamento } from './sped/efd-contribuicoes-faturamento.parser';

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface ProcessarFaturamentoInput {
  tenantId: string;
  empresaId: string;
  cnpj: string;
  gcsUri: string;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface ResultadoProcessamento {
  cnpj: string;
  competencia: string;
  vlFaturamentoBruto: number;
  vlIcms: number;
  vlIpi: number;
  qtdDocumentos: number;
  qtdCfops: number;
}

export interface ResultadoProcessamentoContrib {
  cnpj: string;
  competencia: string;
  vlServicos: number;
  vlPis: number;
  vlCofins: number;
  qtdDocumentosServicos: number;
  /** true quando o registro AMBOS foi criado/atualizado com sucesso. */
  mesclado: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FaturamentoProcessamentoService {
  private readonly logger = new Logger(FaturamentoProcessamentoService.name);

  constructor(
    private readonly gcs: FaturamentoGcsService,
    private readonly prisma: PrismaService,
  ) {}

  // ── EFD ICMS/IPI ────────────────────────────────────────────────────────────

  async processarArquivo(input: ProcessarFaturamentoInput): Promise<ResultadoProcessamento> {
    const { tenantId, empresaId, cnpj, gcsUri } = input;

    this.logger.log(`Iniciando faturamento ICMS: tenantId=${tenantId} cnpj=${cnpj} uri=${gcsUri}`);

    const buffer = await this.gcs.downloadFromUri(gcsUri);
    const hashArquivo = createHash('sha256').update(buffer).digest('hex');
    const faturamento = parseEfdIcmsIpiFaturamento(buffer);

    if (!faturamento.competencia) {
      throw new Error(`Registro 0000 ausente ou DT_INI inválido: ${gcsUri}`);
    }

    const { ano, mes } = parsearCompetencia(faturamento.competencia);

    this.logger.log(
      `EFD ICMS parseado: competencia=${faturamento.competencia} ` +
      `bruto=${faturamento.vlFaturamentoBruto} docs=${faturamento.qtdDocumentos} ` +
      `cfops=${faturamento.cfops.length}`,
    );

    await this.prisma.faturamentoCompetencia.upsert({
      where: { tenantId_empresaId_ano_mes_fonte: { tenantId, empresaId, ano, mes, fonte: 'EFD_ICMS' } },
      create: {
        tenantId, empresaId, cnpj, ano, mes, fonte: 'EFD_ICMS',
        vlFaturamentoBruto: faturamento.vlFaturamentoBruto,
        vlIcms: faturamento.vlIcms,
        vlIpi: faturamento.vlIpi,
        qtdDocumentos: faturamento.qtdDocumentos,
        gcsUri, hashArquivo,
        cfopsJson: JSON.stringify(faturamento.cfops),
      },
      update: {
        cnpj,
        vlFaturamentoBruto: faturamento.vlFaturamentoBruto,
        vlIcms: faturamento.vlIcms,
        vlIpi: faturamento.vlIpi,
        qtdDocumentos: faturamento.qtdDocumentos,
        gcsUri, hashArquivo,
        cfopsJson: JSON.stringify(faturamento.cfops),
      },
    });

    // Tenta mesclar caso EFD_CONTRIB já exista para a mesma competência
    await this.mesclarCompetencias(tenantId, empresaId, ano, mes);

    this.logger.log(`Faturamento ICMS persistido: ${cnpj} ${faturamento.competencia}`);

    return {
      cnpj,
      competencia: faturamento.competencia,
      vlFaturamentoBruto: faturamento.vlFaturamentoBruto,
      vlIcms: faturamento.vlIcms,
      vlIpi: faturamento.vlIpi,
      qtdDocumentos: faturamento.qtdDocumentos,
      qtdCfops: faturamento.cfops.length,
    };
  }

  /** Descobre e processa todos os EFD_ICMS disponíveis no sped_arquivos. */
  async processarTodos(tenantId: string, filtroAno?: number): Promise<ResultadoProcessamento[]> {
    const arquivos = await this.prisma.spedArquivo.findMany({
      where: {
        tenantId,
        tipo: 'EFD_ICMS',
        status: 'DISPONIVEL',
        ...(filtroAno ? { dataDocumento: { gte: new Date(filtroAno, 0, 1), lt: new Date(filtroAno + 1, 0, 1) } } : {}),
      },
      orderBy: { dataDocumento: 'asc' },
    });

    if (arquivos.length === 0) {
      this.logger.warn(`Nenhum EFD_ICMS disponível para tenantId=${tenantId}`);
      return [];
    }

    const resultados: ResultadoProcessamento[] = [];
    for (const arq of arquivos) {
      const empresa = await this.prisma.empresa.findFirst({ where: { tenantId, cnpj: arq.cnpj }, select: { id: true } });
      if (!empresa) {
        this.logger.warn(`Empresa não encontrada CNPJ=${arq.cnpj} — ignorado`);
        continue;
      }
      try {
        resultados.push(await this.processarArquivo({ tenantId, empresaId: empresa.id, cnpj: arq.cnpj, gcsUri: `gs://${arq.gcsBucket}/${arq.gcsPath}` }));
      } catch (err) {
        this.logger.error(`Erro ao processar ${arq.cnpj} / ${arq.nomeArquivo}: ${String(err)}`);
      }
    }
    return resultados;
  }

  // ── EFD Contribuições ────────────────────────────────────────────────────────

  async processarContribArquivo(input: ProcessarFaturamentoInput): Promise<ResultadoProcessamentoContrib> {
    const { tenantId, empresaId, cnpj, gcsUri } = input;

    this.logger.log(`Iniciando faturamento Contrib: tenantId=${tenantId} cnpj=${cnpj} uri=${gcsUri}`);

    const buffer = await this.gcs.downloadFromUri(gcsUri);
    const hashArquivo = createHash('sha256').update(buffer).digest('hex');
    const contrib = parseEfdContribuicoesFaturamento(buffer);

    if (!contrib.competencia) {
      throw new Error(`Registro 0000 ausente ou DT_INI inválido: ${gcsUri}`);
    }

    const { ano, mes } = parsearCompetencia(contrib.competencia);

    this.logger.log(
      `EFD Contrib parseado: competencia=${contrib.competencia} ` +
      `servicos=${contrib.vlServicos} pis=${contrib.vlPis} cofins=${contrib.vlCofins} ` +
      `docs=${contrib.qtdDocumentosServicos}`,
    );

    await this.prisma.faturamentoCompetencia.upsert({
      where: { tenantId_empresaId_ano_mes_fonte: { tenantId, empresaId, ano, mes, fonte: 'EFD_CONTRIB' } },
      create: {
        tenantId, empresaId, cnpj, ano, mes, fonte: 'EFD_CONTRIB',
        vlFaturamentoBruto: contrib.vlServicos,
        vlPis: contrib.vlPis,
        vlCofins: contrib.vlCofins,
        qtdDocumentos: contrib.qtdDocumentosServicos,
        gcsUri, hashArquivo,
      },
      update: {
        cnpj,
        vlFaturamentoBruto: contrib.vlServicos,
        vlPis: contrib.vlPis,
        vlCofins: contrib.vlCofins,
        qtdDocumentos: contrib.qtdDocumentosServicos,
        gcsUri, hashArquivo,
      },
    });

    // Mescla automaticamente se EFD_ICMS já existir para a mesma competência
    const mesclado = await this.mesclarCompetencias(tenantId, empresaId, ano, mes);

    this.logger.log(`Faturamento Contrib persistido: ${cnpj} ${contrib.competencia} mesclado=${mesclado}`);

    return {
      cnpj,
      competencia: contrib.competencia,
      vlServicos: contrib.vlServicos,
      vlPis: contrib.vlPis,
      vlCofins: contrib.vlCofins,
      qtdDocumentosServicos: contrib.qtdDocumentosServicos,
      mesclado,
    };
  }

  /** Descobre e processa todos os EFD_CONTRIBUICOES disponíveis no sped_arquivos. */
  async processarContribTodos(tenantId: string, filtroAno?: number): Promise<ResultadoProcessamentoContrib[]> {
    const arquivos = await this.prisma.spedArquivo.findMany({
      where: {
        tenantId,
        tipo: 'EFD_CONTRIBUICOES',
        status: 'DISPONIVEL',
        ...(filtroAno ? { dataDocumento: { gte: new Date(filtroAno, 0, 1), lt: new Date(filtroAno + 1, 0, 1) } } : {}),
      },
      orderBy: { dataDocumento: 'asc' },
    });

    if (arquivos.length === 0) {
      this.logger.warn(`Nenhum EFD_CONTRIBUICOES disponível para tenantId=${tenantId}`);
      return [];
    }

    const resultados: ResultadoProcessamentoContrib[] = [];
    for (const arq of arquivos) {
      const empresa = await this.prisma.empresa.findFirst({ where: { tenantId, cnpj: arq.cnpj }, select: { id: true } });
      if (!empresa) {
        this.logger.warn(`Empresa não encontrada CNPJ=${arq.cnpj} — ignorado`);
        continue;
      }
      try {
        resultados.push(await this.processarContribArquivo({ tenantId, empresaId: empresa.id, cnpj: arq.cnpj, gcsUri: `gs://${arq.gcsBucket}/${arq.gcsPath}` }));
      } catch (err) {
        this.logger.error(`Erro ao processar contrib ${arq.cnpj} / ${arq.nomeArquivo}: ${String(err)}`);
      }
    }
    return resultados;
  }

  // ── Mesclagem AMBOS ──────────────────────────────────────────────────────────

  /**
   * Cria ou atualiza o registro fonte='AMBOS' combinando EFD_ICMS e EFD_CONTRIB.
   * Só executa quando pelo menos uma das fontes existir.
   * Retorna true se o registro AMBOS foi criado/atualizado.
   */
  async mesclarCompetencias(
    tenantId: string,
    empresaId: string,
    ano: number,
    mes: number,
  ): Promise<boolean> {
    const [icms, contrib] = await Promise.all([
      this.prisma.faturamentoCompetencia.findUnique({
        where: { tenantId_empresaId_ano_mes_fonte: { tenantId, empresaId, ano, mes, fonte: 'EFD_ICMS' } },
      }),
      this.prisma.faturamentoCompetencia.findUnique({
        where: { tenantId_empresaId_ano_mes_fonte: { tenantId, empresaId, ano, mes, fonte: 'EFD_CONTRIB' } },
      }),
    ]);

    // Mesclagem só executa quando AMBAS as fontes estiverem presentes
    if (!icms || !contrib) return false;

    const vlFaturamentoBruto =
      Number(icms?.vlFaturamentoBruto ?? 0) + Number(contrib?.vlFaturamentoBruto ?? 0);
    const vlIcms    = Number(icms?.vlIcms    ?? 0);
    const vlIpi     = Number(icms?.vlIpi     ?? 0);
    const vlPis     = Number(contrib?.vlPis    ?? 0);
    const vlCofins  = Number(contrib?.vlCofins ?? 0);
    const qtdDocumentos =
      (icms?.qtdDocumentos ?? 0) + (contrib?.qtdDocumentos ?? 0);

    const base = icms;

    await this.prisma.faturamentoCompetencia.upsert({
      where: { tenantId_empresaId_ano_mes_fonte: { tenantId, empresaId, ano, mes, fonte: 'AMBOS' } },
      create: {
        tenantId, empresaId, cnpj: base.cnpj, ano, mes, fonte: 'AMBOS',
        vlFaturamentoBruto, vlIcms, vlIpi, vlPis, vlCofins, qtdDocumentos,
        gcsUri: base.gcsUri, hashArquivo: base.hashArquivo,
        cfopsJson: icms?.cfopsJson ?? null,
      },
      update: {
        cnpj: base.cnpj,
        gcsUri: base.gcsUri,
        hashArquivo: base.hashArquivo,
        vlFaturamentoBruto, vlIcms, vlIpi, vlPis, vlCofins, qtdDocumentos,
        cfopsJson: icms?.cfopsJson ?? null,
      },
    });

    this.logger.log(
      `AMBOS mesclado: ${base.cnpj} ${ano}-${String(mes).padStart(2, '0')} ` +
      `bruto=${vlFaturamentoBruto} (icms=${icms?.vlFaturamentoBruto ?? 0} + contrib=${contrib?.vlFaturamentoBruto ?? 0})`,
    );

    return true;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsearCompetencia(competencia: string): { ano: number; mes: number } {
  const [anoStr, mesStr] = competencia.split('-');
  return {
    ano: Number.parseInt(anoStr, 10),
    mes: Number.parseInt(mesStr, 10),
  };
}
