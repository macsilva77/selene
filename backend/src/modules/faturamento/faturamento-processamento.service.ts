import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { FaturamentoGcsService } from './faturamento-gcs.service';
import { FaturamentoQueryService } from './faturamento-query.service';
import { categorizarCfopsArray } from './cfop-util';
import { parseEfdIcmsIpiFaturamento } from './sped/efd-icms-ipi-faturamento.parser';
import { parseEfdContribuicoesFaturamento } from './sped/efd-contribuicoes-faturamento.parser';
import type { SpedArquivoDisponivelEvent } from '../sped/sped.service';

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
    private readonly queryService: FaturamentoQueryService,
  ) {}

  // ── EFD ICMS/IPI ────────────────────────────────────────────────────────────

  async processarArquivo(input: ProcessarFaturamentoInput): Promise<ResultadoProcessamento> {
    const { tenantId, empresaId, cnpj, gcsUri } = input;

    this.logger.log(`Iniciando faturamento EFD ICMS: empresaId=${empresaId}`);
    this.logger.debug(`uri=${gcsUri}`);

    const { stream, hashArquivo } = await this.gcs.openStream(gcsUri);
    const faturamento = await parseEfdIcmsIpiFaturamento(stream);

    if (!faturamento.competencia) {
      throw new Error(`Registro 0000 ausente ou DT_INI inválido: ${gcsUri}`);
    }

    const cnpjArquivo = faturamento.cnpj.replace(/\D/g, '').padStart(14, '0');
    const cnpjInput   = cnpj.replace(/\D/g, '').padStart(14, '0');
    if (cnpjArquivo && cnpjArquivo !== cnpjInput) {
      throw new Error(`CNPJ do arquivo (${cnpjArquivo}) diverge do informado (${cnpjInput}): ${gcsUri}`);
    }

    const { ano, mes } = parsearCompetencia(faturamento.competencia);

    this.logger.debug(
      `EFD ICMS parseado: competencia=${faturamento.competencia} ` +
      `bruto=${faturamento.vlFaturamentoBruto} docs=${faturamento.qtdDocumentos} ` +
      `cfops=${faturamento.cfops.length}`,
    );

    const cfopCats = categorizarCfopsArray(faturamento.cfops);

    await this.prisma.faturamentoCompetencia.upsert({
      where: { tenantId_empresaId_ano_mes_fonte: { tenantId, empresaId, ano, mes, fonte: 'EFD_ICMS' } },
      create: {
        tenantId, empresaId, cnpj, ano, mes, fonte: 'EFD_ICMS',
        vlFaturamentoBruto:   faturamento.vlFaturamentoBruto,
        vlIcms:               faturamento.vlIcms,
        vlIpi:                faturamento.vlIpi,
        qtdDocumentos:        faturamento.qtdDocumentos,
        vlComprasBruto:       faturamento.vlComprasBruto,
        qtdDocumentosCompras: faturamento.qtdDocumentosCompras,
        ...cfopCats,
        gcsUri, hashArquivo,
        cfopsJson: JSON.stringify(faturamento.cfops),
      },
      update: {
        cnpj,
        vlFaturamentoBruto:   faturamento.vlFaturamentoBruto,
        vlIcms:               faturamento.vlIcms,
        vlIpi:                faturamento.vlIpi,
        qtdDocumentos:        faturamento.qtdDocumentos,
        vlComprasBruto:       faturamento.vlComprasBruto,
        qtdDocumentosCompras: faturamento.qtdDocumentosCompras,
        ...cfopCats,
        gcsUri, hashArquivo,
        cfopsJson: JSON.stringify(faturamento.cfops),
      },
    });

    // Tenta mesclar caso EFD_CONTRIB já exista para a mesma competência
    await this.mesclarCompetencias(tenantId, empresaId, ano, mes);

    this.logger.log(`Faturamento EFD ICMS persistido: empresaId=${empresaId} competencia=${faturamento.competencia}`);

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

    const cnpjs = [...new Set(arquivos.map(a => a.cnpj))];
    const empresaList = await this.prisma.empresa.findMany({
      where: { tenantId, cnpj: { in: cnpjs } },
      select: { id: true, cnpj: true },
    });
    const empresaMap = new Map(empresaList.map(e => [e.cnpj, e.id]));

    const resultados: ResultadoProcessamento[] = [];
    for (const arq of arquivos) {
      const empresaId = empresaMap.get(arq.cnpj);
      if (!empresaId) {
        this.logger.warn(`Empresa não encontrada CNPJ=${arq.cnpj} — ignorado`);
        continue;
      }
      try {
        resultados.push(await this.processarArquivo({ tenantId, empresaId, cnpj: arq.cnpj, gcsUri: `gs://${arq.gcsBucket}/${arq.gcsPath}` }));
      } catch (err) {
        this.logger.error(`Erro ao processar ${arq.cnpj} / ${arq.nomeArquivo}: ${String(err)}`);
      }
    }
    return resultados;
  }

  // ── EFD Contribuições ────────────────────────────────────────────────────────

  async processarContribArquivo(input: ProcessarFaturamentoInput): Promise<ResultadoProcessamentoContrib> {
    const { tenantId, empresaId, cnpj, gcsUri } = input;

    this.logger.log(`Iniciando faturamento EFD Contrib: empresaId=${empresaId}`);
    this.logger.debug(`uri=${gcsUri}`);

    const { stream, hashArquivo } = await this.gcs.openStream(gcsUri);
    const contrib = await parseEfdContribuicoesFaturamento(stream);

    if (!contrib.competencia) {
      throw new Error(`Registro 0000 ausente ou DT_INI inválido: ${gcsUri}`);
    }

    const cnpjArquivo = contrib.cnpj.replace(/\D/g, '').padStart(14, '0');
    const cnpjInput   = cnpj.replace(/\D/g, '').padStart(14, '0');
    if (cnpjArquivo && cnpjArquivo !== cnpjInput) {
      throw new Error(`CNPJ do arquivo (${cnpjArquivo}) diverge do informado (${cnpjInput}): ${gcsUri}`);
    }

    const { ano, mes } = parsearCompetencia(contrib.competencia);

    this.logger.debug(
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

    this.logger.log(`Faturamento EFD Contrib persistido: empresaId=${empresaId} competencia=${contrib.competencia} mesclado=${mesclado}`);

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

    const cnpjs = [...new Set(arquivos.map(a => a.cnpj))];
    const empresaList = await this.prisma.empresa.findMany({
      where: { tenantId, cnpj: { in: cnpjs } },
      select: { id: true, cnpj: true },
    });
    const empresaMap = new Map(empresaList.map(e => [e.cnpj, e.id]));

    const resultados: ResultadoProcessamentoContrib[] = [];
    for (const arq of arquivos) {
      const empresaId = empresaMap.get(arq.cnpj);
      if (!empresaId) {
        this.logger.warn(`Empresa não encontrada CNPJ=${arq.cnpj} — ignorado`);
        continue;
      }
      try {
        resultados.push(await this.processarContribArquivo({ tenantId, empresaId, cnpj: arq.cnpj, gcsUri: `gs://${arq.gcsBucket}/${arq.gcsPath}` }));
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

    // Invalida cache independentemente de haver mesclagem — qualquer escrita torna o cache obsoleto
    await this.queryService.invalidarEmpresa(tenantId, empresaId);

    // Mesclagem só executa quando AMBAS as fontes estiverem presentes
    if (!icms || !contrib) return false;

    const vlFaturamentoBruto = Number(icms.vlFaturamentoBruto) + Number(contrib.vlFaturamentoBruto);
    const vlIcms             = Number(icms.vlIcms);
    const vlIpi              = Number(icms.vlIpi);
    const vlPis              = Number(contrib.vlPis);
    const vlCofins           = Number(contrib.vlCofins);
    const qtdDocumentos      = icms.qtdDocumentos + contrib.qtdDocumentos;
    const vlComprasBruto     = Number(icms.vlComprasBruto);
    const qtdDocumentosCompras = icms.qtdDocumentosCompras;

    // CFOPs vêm do EFD_ICMS — EFD_CONTRIB não tem C100/C190
    const cfopCats = {
      vlEstaduais:      Number(icms.vlEstaduais),
      vlInterestaduais: Number(icms.vlInterestaduais),
      vlExportacoes:    Number(icms.vlExportacoes),
      vlDevolucoes:     Number(icms.vlDevolucoes),
      vlTransferencias: Number(icms.vlTransferencias),
      vlRemessas:       Number(icms.vlRemessas),
    };

    await this.prisma.faturamentoCompetencia.upsert({
      where: { tenantId_empresaId_ano_mes_fonte: { tenantId, empresaId, ano, mes, fonte: 'AMBOS' } },
      create: {
        tenantId, empresaId, cnpj: icms.cnpj, ano, mes, fonte: 'AMBOS',
        vlFaturamentoBruto, vlIcms, vlIpi, vlPis, vlCofins, qtdDocumentos,
        vlComprasBruto, qtdDocumentosCompras,
        ...cfopCats,
        gcsUri: icms.gcsUri, hashArquivo: icms.hashArquivo,
        cfopsJson: icms.cfopsJson ?? null,
      },
      update: {
        cnpj: icms.cnpj,
        gcsUri: icms.gcsUri,
        hashArquivo: icms.hashArquivo,
        vlFaturamentoBruto, vlIcms, vlIpi, vlPis, vlCofins, qtdDocumentos,
        vlComprasBruto, qtdDocumentosCompras,
        ...cfopCats,
        cfopsJson: icms.cfopsJson ?? null,
      },
    });

    this.logger.log(
      `AMBOS mesclado: empresaId=${empresaId} ${ano}-${String(mes).padStart(2, '0')} bruto=${vlFaturamentoBruto}`,
    );

    return true;
  }

  // ── Auto-processamento via evento interno ────────────────────────────────────

  @OnEvent('sped.arquivo.disponivel', { async: true })
  async handleSpedDisponivel(event: SpedArquivoDisponivelEvent): Promise<void> {
    const { tenantId, cnpj, tipo, gcsUri } = event;

    if (tipo !== 'EFD_ICMS' && tipo !== 'EFD_CONTRIBUICOES') return;

    try {
      const empresa = await this.prisma.empresa.findFirst({
        where: { tenantId, cnpj },
        select: { id: true },
      });

      if (!empresa) {
        this.logger.warn(`handleSpedDisponivel: empresa não encontrada tipo=${tipo}`);
        return;
      }

      if (tipo === 'EFD_ICMS') {
        await this.processarArquivo({ tenantId, empresaId: empresa.id, cnpj, gcsUri });
      } else {
        await this.processarContribArquivo({ tenantId, empresaId: empresa.id, cnpj, gcsUri });
      }
    } catch (err) {
      this.logger.error(`handleSpedDisponivel: erro tipo=${tipo}: ${String(err)}`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsearCompetencia(competencia: string): { ano: number; mes: number } {
  const parts = competencia.split('-');
  if (parts.length !== 2) throw new Error(`Competência inválida: "${competencia}"`);
  const ano = Number.parseInt(parts[0] ?? '', 10);
  const mes = Number.parseInt(parts[1] ?? '', 10);
  if (Number.isNaN(ano) || Number.isNaN(mes)) throw new Error(`Competência inválida: "${competencia}"`);
  return { ano, mes };
}
