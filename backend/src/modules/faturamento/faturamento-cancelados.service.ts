import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../database/prisma.service';
import { FaturamentoGcsService } from './faturamento-gcs.service';
import { parseEfdIcmsCancelados, type DocCancelado } from './sped/efd-icms-cancelados.parser';
import { agregarCancelados, type CanceladosAgregado, type FaturadoAno } from './sped/cancelados-agregacao';

const CACHE_TTL_MS = 60 * 60 * 1_000;       // 1 hora
const MAX_DOCS_DETALHE = 2_000;             // teto da lista detalhada retornada

export interface CanceladosResposta extends CanceladosAgregado {
  empresaId:    string;
  cnpj:         string;
  nome:         string;
  totalDocs:    number;      // total de cancelados (pode exceder docs.length)
  docs:         DocCancelado[]; // detalhe limitado a MAX_DOCS_DETALHE (maiores valores)
}

@Injectable()
export class FaturamentoCanceladosService {
  private readonly logger = new Logger(FaturamentoCanceladosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcs: FaturamentoGcsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private async comRetry<T>(fn: () => Promise<T>, tentativas = 4): Promise<T> {
    for (let i = 1; ; i++) {
      try { return await fn(); }
      catch (e) {
        if (i >= tentativas) throw e;
        await new Promise(r => setTimeout(r, 400 * i));
      }
    }
  }

  /** Re-parseia os EFD ICMS da empresa e devolve cancelados agregados (cache 1h). */
  async cancelados(tenantId: string, empresaId: string): Promise<CanceladosResposta> {
    const empresa = await this.prisma.empresa.findFirst({
      where:  { id: empresaId, tenantId },
      select: { id: true, cnpj: true, nome: true },
    });
    if (!empresa) throw new NotFoundException(`Empresa ${empresaId} não encontrada`);

    const ck = `fat:cancelados:${tenantId}:${empresaId}`;
    const cached = await this.cache.get<CanceladosResposta>(ck);
    if (cached) return cached;

    const arquivos = await this.prisma.obrigacaoAcessoria.findMany({
      where: {
        tipoObrigacao: 'EFD_ICMS_IPI',
        cnpj: empresa.cnpj,
        versaoAtual: true,
        statusProcessamento: { in: ['Recebido', 'Processado'] },
      },
      select: { caminhoBucket: true },
      orderBy: { dataInicial: 'asc' },
    });

    const t0 = Date.now();
    const docs: DocCancelado[] = [];
    for (const arq of arquivos) {
      if (!arq.caminhoBucket) continue;
      try {
        const lista = await this.comRetry(async () => {
          const { stream } = await this.gcs.openStream(arq.caminhoBucket);
          return parseEfdIcmsCancelados(stream);
        });
        docs.push(...lista);
      } catch (err) {
        this.logger.warn(`Falha ao ler ${arq.caminhoBucket}: ${String(err)}`);
      }
    }

    // Faturamento bruto VÁLIDO (saídas) por ano — base das taxas de cancelamento.
    const fatRows = await this.prisma.faturamentoCompetencia.groupBy({
      by:    ['ano'],
      where: { tenantId, empresaId, fonte: 'EFD_ICMS' },
      _sum:  { vlFaturamentoBruto: true },
      _count: true,
    });
    const faturadoPorAno = new Map<number, FaturadoAno>(
      fatRows.map(r => [r.ano, { valor: Number(r._sum.vlFaturamentoBruto ?? 0), qtd: r._count }]),
    );

    const agregado = agregarCancelados(docs, faturadoPorAno);
    const detalhe = [...docs].sort((a, b) => b.vlDoc - a.vlDoc).slice(0, MAX_DOCS_DETALHE);

    const resposta: CanceladosResposta = {
      empresaId: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome,
      ...agregado, totalDocs: docs.length, docs: detalhe,
    };

    this.logger.debug(`cancelados ${empresa.cnpj}: ${docs.length} docs em ${arquivos.length} arquivos (${Date.now() - t0}ms)`);
    await this.cache.set(ck, resposta, CACHE_TTL_MS);
    return resposta;
  }
}
