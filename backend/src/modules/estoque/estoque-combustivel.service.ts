import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../database/prisma.service';
import { FaturamentoGcsService } from '../faturamento/faturamento-gcs.service';
import { parseEfdBloco1300, agregarCombustivel, type MovimentoCombustivel } from './sped/efd-bloco1300-combustivel.parser';
import { analisarCombustivel, type AnaliseCombustivel } from './sped/estoque-combustivel.analise';
import { dedupPorCompetencia } from './obrigacao-dedup';

const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hora

export interface RespostaCombustivel extends AnaliseCombustivel {
  empresaId: string;
  nome: string;
  ano: number;
  arquivos: number; // EFDs lidos
}

@Injectable()
export class EstoqueCombustivelService {
  private readonly logger = new Logger(EstoqueCombustivelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcs: FaturamentoGcsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** Estoque fiscal de combustível (Bloco 1300) — re-parse on-demand do EFD ICMS, cache 1h. */
  async combustivel(tenantId: string, empresaId: string, ano: number): Promise<RespostaCombustivel> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId, tenantId },
      select: { id: true, cnpj: true, nome: true },
    });
    if (!empresa) throw new NotFoundException(`Empresa ${empresaId} não encontrada`);

    const ck = `estoque:combustivel:${tenantId}:${empresaId}:${ano}`;
    const cached = await this.cache.get<RespostaCombustivel>(ck);
    if (cached) return cached;

    // dedup por competência: nesta base versaoAtual é pouco confiável (ver obrigacao-dedup);
    // sem isso, meses retificados teriam o Bloco 1300 lido em dobro (volumes inflados).
    const todas = await this.prisma.obrigacaoAcessoria.findMany({
      where: {
        tipoObrigacao: 'EFD_ICMS_IPI',
        cnpj: empresa.cnpj,
        statusProcessamento: { in: ['Recebido', 'Processado'] },
        dataInicial: { gte: new Date(`${ano}-01-01`), lte: new Date(`${ano}-12-31`) },
      },
      select: { caminhoBucket: true, dataInicial: true, dataFinal: true, versao: true, criadoEm: true },
      orderBy: { dataInicial: 'asc' },
    });
    const arquivos = dedupPorCompetencia(todas);

    const movs: MovimentoCombustivel[] = [];
    for (const arq of arquivos) {
      if (!arq.caminhoBucket) continue;
      try {
        const { stream } = await this.gcs.openStream(arq.caminhoBucket);
        movs.push(parseEfdBloco1300(await streamToBuffer(stream)));
      } catch (err) {
        this.logger.warn(`Falha ao ler ${arq.caminhoBucket}: ${String(err)}`);
      }
    }

    const analise = analisarCombustivel(agregarCombustivel(movs));
    const resposta: RespostaCombustivel = {
      ...analise,
      empresaId: empresa.id,
      nome: empresa.nome,
      ano,
      arquivos: arquivos.length,
    };

    await this.cache.set(ck, resposta, CACHE_TTL_MS);
    return resposta;
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}
