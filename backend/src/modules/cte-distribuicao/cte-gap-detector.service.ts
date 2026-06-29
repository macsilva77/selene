import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Detecta lacunas (gaps) entre NSUs consecutivos recebidos da SEFAZ e registra
 * cada gap em `CteGapNsu` para recuperação posterior via `consNSU`.
 *
 * Contexto — NT 2015.002: o Ambiente Nacional gera NSU sem lacunas; uma lacuna
 * na base do interessado indica falha na distribuição.
 *
 * Algoritmo: ordena os NSUs do lote, compara pares consecutivos DENTRO do lote
 * (gaps entre lotes não são reais — são NSUs de outros CNPJs) e registra cada
 * NSU faltante via createMany idempotente.
 */
@Injectable()
export class CteGapDetectorService {
  private readonly logger = new Logger(CteGapDetectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async detectarGaps(
    tenantId: string,
    cnpj: string,
    configId: string,
    nsusRecebidos: string[],
  ): Promise<number> {
    if (nsusRecebidos.length < 2) return 0;

    const nsusSorted = [...nsusRecebidos].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
    );

    const gaps: Array<{ nsuFaltante: string; nsuAnterior: string; nsuPosterior: string }> = [];

    for (let i = 0; i < nsusSorted.length - 1; i++) {
      const atual = BigInt(nsusSorted[i]!);
      const proximo = BigInt(nsusSorted[i + 1]!);

      if (proximo > atual + 1n) {
        const qtdGaps = proximo - atual - 1n;
        const limite = qtdGaps > 50n ? 50n : qtdGaps;
        for (let g = 1n; g <= limite; g++) {
          gaps.push({
            nsuFaltante: String(atual + g).padStart(15, '0'),
            nsuAnterior: nsusSorted[i]!,
            nsuPosterior: nsusSorted[i + 1]!,
          });
        }
      }
    }

    if (gaps.length === 0) return 0;

    this.logger.warn(
      `CNPJ=${cnpj} — ${gaps.length} gap(s) NSU detectado(s): ` +
        gaps.map((g) => g.nsuFaltante).join(', '),
    );

    const { count } = await this.prisma.cteGapNsu.createMany({
      data: gaps.map((g) => ({
        tenantId,
        cnpj,
        configId,
        nsuFaltante: g.nsuFaltante,
        nsuAnterior: g.nsuAnterior,
        nsuPosterior: g.nsuPosterior,
        proximaTentativa: new Date(),
      })),
      skipDuplicates: true,
    });

    if (count > 0) {
      this.logger.log(`CNPJ=${cnpj} — ${count} gap(s) novo(s) registrado(s) em cte_gap_nsus`);
    }

    return count;
  }
}
