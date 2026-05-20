import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Detecta lacunas (gaps) entre NSUs consecutivos recebidos da SEFAZ
 * e registra cada gap em `DfeGapNsu` para recuperação posterior via `consNSU`.
 *
 * Contexto — MOC 7.0 seção 5.7.4.5:
 *  "Considerando que o Ambiente Nacional gera NSU sem lacunas, a identificação
 *   de alguma lacuna na base de dados do interessado indica que houve alguma
 *   falha no processo de distribuição dos documentos."
 *
 * Algoritmo:
 *  1. Ordena os NSUs do lote numericamente.
 *  2. Compara pares consecutivos DENTRO do lote: gaps internos ao lote.
 *  3. Registra cada NSU faltante via upsert idempotente (skipDuplicates).
 *
 * Importante:
 *  - NSUs globais do SEFAZ NÃO são por CNPJ. Entre dois lotes consecutivos,
 *    a diferença de NSU não indica gaps reais — apenas NSUs de outros CNPJs.
 *    Só faz sentido detectar gaps DENTRO do mesmo lote retornado.
 *  - NSUs são comparados numericamente (BigInt) para suportar valores grandes.
 */
@Injectable()
export class DfeGapDetectorService {
  private readonly logger = new Logger(DfeGapDetectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Detecta e registra lacunas NSU dentro de um lote retornado pela SEFAZ.
   *
   * @param tenantId      ID do tenant
   * @param cnpj          CNPJ monitorado (14 dígitos sem máscara)
   * @param configId      ID do DfeConfig (FK em DfeGapNsu)
   * @param nsusRecebidos NSUs presentes no lote retornado pela SEFAZ (15 dígitos)
   * @returns Quantidade de novos gaps registrados
   */
  async detectarGaps(
    tenantId: string,
    cnpj: string,
    configId: string,
    nsusRecebidos: string[],
  ): Promise<number> {
    if (nsusRecebidos.length < 2) return 0;

    // Ordena numericamente (os NSUs são strings de 15 dígitos zero-padded)
    const nsusSorted = [...nsusRecebidos].sort((a, b) =>
      BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
    );

    const gaps: Array<{ nsuFaltante: string; nsuAnterior: string; nsuPosterior: string }> = [];

    // ── Gaps internos ao lote ───────────────────────────────────────────────
    for (let i = 0; i < nsusSorted.length - 1; i++) {
      const atual = BigInt(nsusSorted[i]!);
      const proximo = BigInt(nsusSorted[i + 1]!);

      if (proximo > atual + 1n) {
        const qtdGaps = proximo - atual - 1n;
        // Limita a 50 gaps por intervalo (proteção)
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

    // ── Persiste via upsert idempotente ────────────────────────────────────
    // createMany com skipDuplicates ignora registros que violam o unique(tenantId, nsuFaltante)
    const { count } = await this.prisma.dfeGapNsu.createMany({
      data: gaps.map((g) => ({
        tenantId,
        cnpj,
        configId,
        nsuFaltante: g.nsuFaltante,
        nsuAnterior: g.nsuAnterior,
        nsuPosterior: g.nsuPosterior,
        // proximaTentativa: imediatamente elegível para o próximo ciclo do job
        proximaTentativa: new Date(),
      })),
      skipDuplicates: true,
    });

    if (count > 0) {
      this.logger.log(`CNPJ=${cnpj} — ${count} gap(s) novo(s) registrado(s) em dfe_gap_nsus`);
    }

    return count;
  }
}
