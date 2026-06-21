import { Injectable, Logger } from '@nestjs/common';
import { EcfDataSourceService } from './ecf-data-source.service';

/**
 * Resolvedor de bloco demonstrativo da ECF (Fase 1).
 *
 * A demonstração vive em blocos diferentes conforme a tributação, mas os códigos
 * referenciais (1.x/2.x no BP, 3.x na DRE) são os MESMOS nos três:
 *   Lucro Real        → L100 / L300
 *   Presumido/Arbitr. → P100 / P150
 *   Imune/Isenta      → U100 / U150
 *
 * Detecção robusta e à prova de versão: decide pela PRESENÇA EFETIVA de registros
 * (ordem L → P → U), não pelo regime armazenado (que pode estar errado — ex.:
 * SESSION BRASIL gravada como "lucro_real" sendo Presumido).
 */

export type RegimeDetectado = 'lucro_real' | 'lucro_presumido' | 'imune_isenta';

export interface BlocoEcf {
  regime: RegimeDetectado;
  bp:     'L100' | 'P100' | 'U100';   // registro do balanço (saldo)
  dre:    'L300' | 'P150' | 'U150';   // registro da DRE (fluxo)
}

// Ordem de tentativa: Real → Presumido → Imune/Isenta. Marcadores = registros que,
// se presentes, indicam o bloco. DRE primeiro (é o que zera no bug); BP como reforço.
const CANDIDATOS: ReadonlyArray<BlocoEcf & { marcadores: readonly string[] }> = [
  { regime: 'lucro_real',      bp: 'L100', dre: 'L300', marcadores: ['L300', 'L100'] },
  { regime: 'lucro_presumido', bp: 'P100', dre: 'P150', marcadores: ['P150', 'P100'] },
  { regime: 'imune_isenta',    bp: 'U100', dre: 'U150', marcadores: ['U150', 'U100'] },
];

/**
 * Detecção pura (testável sem I/O): retorna o bloco cujo registro está presente,
 * na ordem L → P → U, ou null se nenhum bloco demonstrativo existe.
 */
export function detectarBlocoEcf(registrosPresentes: ReadonlySet<string>): BlocoEcf | null {
  for (const c of CANDIDATOS) {
    if (c.marcadores.some(m => registrosPresentes.has(m))) {
      return { regime: c.regime, bp: c.bp, dre: c.dre };
    }
  }
  return null;
}

@Injectable()
export class EcfBlocoResolver {
  private readonly logger = new Logger(EcfBlocoResolver.name);

  constructor(private readonly dataSource: EcfDataSourceService) {}

  /**
   * Resolve o bloco demonstrativo de uma empresa/exercício pela presença de
   * registros. `regimeArmazenado` (opcional) é só validação cruzada: se divergir
   * do bloco detectado, loga warning — o detectado prevalece.
   */
  async resolver(
    empresaId: string,
    exercicio: number,
    regimeArmazenado?: string | null,
  ): Promise<BlocoEcf | null> {
    const presentes = await this.dataSource.registrosDisponiveis(empresaId, exercicio);
    const bloco = detectarBlocoEcf(presentes);
    if (bloco && regimeArmazenado && regimeArmazenado !== bloco.regime) {
      this.logger.warn(
        `[Bloco] empresaId=${empresaId} exercicio=${exercicio}: regime armazenado='${regimeArmazenado}' ` +
        `diverge do bloco presente (${bloco.dre} → '${bloco.regime}'). Usando o detectado.`,
      );
    }
    return bloco;
  }
}
