import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../database/prisma.service';
import { FaturamentoGcsService } from '../faturamento/faturamento-gcs.service';
import { parseEfdBlocoH, type Inventario } from './sped/efd-bloco-h.parser';
import { parseEfdMovimentoC170, agregarMovimentos, type MovimentoC170 } from './sped/efd-movimento-c170.parser';
import { reconciliar, fotoDeInventario, type ResultadoReconciliacao } from './sped/estoque-fiscal.reconciliacao';
import { analisarInventario, type AnaliseEstoqueBlocoH } from './sped/efd-bloco-h.analise';
import { dedupPorCompetencia } from './obrigacao-dedup';

const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hora

export interface RespostaEstoqueFiscal extends ResultadoReconciliacao {
  empresaId: string;
  nome: string;
  ano: number;
  temFotoInicial: boolean;
  temFotoFinal: boolean;
  arquivosMovimento: number;       // EFDs do ano lidos para o C170
  analiseFinal: AnaliseEstoqueBlocoH | null; // composição por natureza/NCM/ABC da foto final
}

@Injectable()
export class EstoqueFiscalService {
  private readonly logger = new Logger(EstoqueFiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcs: FaturamentoGcsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Estoque fiscal Bloco H + C170 (re-parse on-demand do EFD ICMS, cache 1h).
   *
   * Para reconciliar o ano `ano`:
   *   - foto inicial = inventário de 31/12/(ano−1) → declarado no EFD de fev/(ano);
   *   - foto final   = inventário de 31/12/(ano)   → declarado no EFD de fev/(ano+1);
   *   - movimento    = C170 das 12 competências do próprio `ano`.
   * Varremos a janela [ano-01 … (ano+1)-12] e selecionamos as fotos por DT_INV.
   */
  async reconciliar(tenantId: string, empresaId: string, ano: number): Promise<RespostaEstoqueFiscal> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId, tenantId },
      select: { id: true, cnpj: true, nome: true },
    });
    if (!empresa) throw new NotFoundException(`Empresa ${empresaId} não encontrada`);

    const ck = `estoque:fiscal:${tenantId}:${empresaId}:${ano}`;
    const cached = await this.cache.get<RespostaEstoqueFiscal>(ck);
    if (cached) return cached;

    // NÃO filtramos por versaoAtual: nesta base o flag está corrompido (original e
    // retificadora podem ambos vir como true, violando a RN-11). Buscamos todas as
    // versões e deduplicamos por competência mantendo a mais recente (maior `versao`).
    const todas = await this.prisma.obrigacaoAcessoria.findMany({
      where: {
        tipoObrigacao: 'EFD_ICMS_IPI',
        cnpj: empresa.cnpj,
        statusProcessamento: { in: ['Recebido', 'Processado'] },
        dataInicial: { gte: new Date(`${ano}-01-01`), lte: new Date(`${ano + 1}-12-31`) },
      },
      select: { caminhoBucket: true, dataInicial: true, dataFinal: true, versao: true, criadoEm: true },
      orderBy: { dataInicial: 'asc' },
    });
    const arquivos = dedupPorCompetencia(todas);

    const dtInicial = `${ano - 1}-12-31`;
    const dtFinal = `${ano}-12-31`;

    let invInicial: Inventario | null = null;
    let invFinal: Inventario | null = null;
    const movs: MovimentoC170[] = [];
    let arquivosMovimento = 0;

    for (const arq of arquivos) {
      if (!arq.caminhoBucket) continue;
      let buf: Buffer;
      try {
        const { stream } = await this.gcs.openStream(arq.caminhoBucket);
        buf = await streamToBuffer(stream);
      } catch (err) {
        this.logger.warn(`Falha ao ler ${arq.caminhoBucket}: ${String(err)}`);
        continue;
      }

      // fotos (Bloco H) — seleciona por DT_INV em qualquer arquivo da janela
      try {
        const blocoH = parseEfdBlocoH(buf);
        for (const inv of blocoH.inventarios) {
          if (inv.dtInv === dtInicial && !invInicial) invInicial = inv;
          if (inv.dtInv === dtFinal && !invFinal) invFinal = inv;
        }
      } catch (err) {
        this.logger.warn(`Falha ao parsear Bloco H de ${arq.caminhoBucket}: ${String(err)}`);
      }

      // movimento (C170) — apenas competências do próprio ano
      if (arq.dataInicial && arq.dataInicial.getUTCFullYear() === ano) {
        try {
          movs.push(parseEfdMovimentoC170(buf));
          arquivosMovimento++;
        } catch (err) {
          this.logger.warn(`Falha ao parsear C170 de ${arq.caminhoBucket}: ${String(err)}`);
        }
      }
    }

    const movimento = agregarMovimentos(movs);
    // garante o CNPJ no resultado mesmo quando não há nenhum C170 lido
    if (!movimento.cnpj) movimento.cnpj = empresa.cnpj;

    const resultado = reconciliar(
      fotoDeInventario(invInicial),
      movimento,
      fotoDeInventario(invFinal),
    );

    const resposta: RespostaEstoqueFiscal = {
      ...resultado,
      empresaId: empresa.id,
      nome: empresa.nome,
      ano,
      temFotoInicial: invInicial !== null,
      temFotoFinal: invFinal !== null,
      arquivosMovimento,
      analiseFinal: invFinal ? analisarInventario(invFinal) : null,
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
