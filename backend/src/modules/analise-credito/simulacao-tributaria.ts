/**
 * Simulação Tributária — Simples Nacional × Lucro Presumido × Lucro Real.
 *
 * Motor PURO (sem I/O): recebe a receita bruta anual + lucro contábil + atividade
 * e devolve, para cada regime, a carga de tributos FEDERAIS sobre receita/lucro
 * (IRPJ, CSLL, PIS, COFINS) com MEMÓRIA DE CÁLCULO passo a passo — cada número é
 * rastreável até a fórmula, a alíquota e a base que o gerou.
 *
 * Escopo (premissas explícitas, ver `OBS_ESCOPO`):
 *  - Compara os tributos FEDERAIS. ICMS/ISS e INSS patronal (CPP) ficam FORA de
 *    Presumido/Real (são iguais nos dois e dependem de folha que não temos).
 *  - No Simples, o DAS é unificado: além dos federais ele embute CPP e ICMS/ISS.
 *    Por isso devolvemos a PARTILHA do DAS (% de cada tributo) — assim dá pra ver
 *    a fatia federal (comparável) e a fatia de CPP+ICMS/ISS (vantagem do Simples).
 *  - A RECOMENDAÇÃO é feita pela fatia FEDERAL (base 1:1 entre os três regimes).
 *
 * Fontes: RIR/2018 (Lucro Presumido/Real), Lei 9.718/98 (PIS/COFINS cumulativo),
 * Leis 10.637/02 e 10.833/03 (não-cumulativo), LC 123/2006 Anexos I/II/III e a
 * tabela de partilha vigente (a partir de 2018). Valores 2024/2025.
 */

/* ─── Tipos ──────────────────────────────────────────────────────────────── */

export type Atividade = 'comercio' | 'industria' | 'servico';
export type Regime = 'simples_nacional' | 'lucro_presumido' | 'lucro_real';

/** Um passo da memória de cálculo: rótulo + fórmula textual + valor resultante. */
export interface PassoMemoria {
  rotulo: string;
  formula?: string;
  valor: number;
  /** quando o passo é um percentual/alíquota e não um valor em R$ */
  tipo?: 'moeda' | 'percentual' | 'fator';
}

/** Um tributo apurado dentro de um regime, com sua memória. */
export interface TributoLinha {
  sigla: string;
  nome: string;
  valor: number;
  /** participação no DAS (só Simples) — fração 0–1 */
  partilha?: number;
  memoria: PassoMemoria[];
}

export interface RegimeSimulado {
  regime: Regime;
  rotulo: string;
  elegivel: boolean;
  /** total FEDERAL (IRPJ+CSLL+PIS+COFINS) — base de comparação 1:1 */
  totalFederal: number | null;
  /** total do DAS (só Simples) — federais + CPP + ICMS/ISS */
  totalUnificado?: number | null;
  /** carga federal ÷ receita bruta */
  cargaEfetiva: number | null;
  tributos: TributoLinha[];
  /** estimado quando faltou lucro contábil real (Lucro Real sobre margem-proxy) */
  estimado: boolean;
  observacoes: string[];
}

export interface EntradaSimulacao {
  receitaBruta: number;
  /** lucro antes do IRPJ/CSLL (LAIR) contábil, se conhecido (ECF) */
  lairContabil: number | null;
  /** margem (0–1) usada p/ estimar o LAIR quando não há ECF de Lucro Real */
  margemProxy: number | null;
  atividade: Atividade;
  regimeAtual: Regime | null;
}

export interface ResultadoSimulacao {
  receitaBruta: number;
  atividade: Atividade;
  regimeAtual: Regime | null;
  regimes: RegimeSimulado[];
  /** regime elegível de menor carga federal */
  recomendado: Regime | null;
  /** economia anual do recomendado vs. regime atual (federal) — pode ser negativa */
  economiaVsAtual: number | null;
  premissas: string[];
}

/* ─── Constantes legais ──────────────────────────────────────────────────── */

const TETO_SIMPLES = 4_800_000; // RBT12 máximo p/ optar pelo Simples (LC 123 art. 3º)
const ADICIONAL_IRPJ_LIMITE = 240_000; // R$ 20.000/mês × 12 — acima disso, +10% de IRPJ
const ALIQ_IRPJ = 0.15;
const ADICIONAL_IRPJ = 0.10;
const ALIQ_CSLL = 0.09;

// Presunção do Lucro Presumido (RIR/2018) — base de IRPJ e de CSLL por atividade.
const PRESUNCAO: Record<Atividade, { irpj: number; csll: number }> = {
  comercio:  { irpj: 0.08, csll: 0.12 },
  industria: { irpj: 0.08, csll: 0.12 },
  servico:   { irpj: 0.32, csll: 0.32 },
};

// PIS/COFINS cumulativo (Presumido) × não-cumulativo (Real).
const PIS_CUMULATIVO = 0.0065;
const COFINS_CUMULATIVO = 0.03;
const PIS_NAO_CUMULATIVO = 0.0165;
const COFINS_NAO_CUMULATIVO = 0.076;

/** Faixa do Simples: limite superior do RBT12, alíquota nominal e parcela a deduzir. */
interface FaixaSimples { ate: number; aliq: number; deduzir: number }

// LC 123/2006 — Anexos I (comércio), II (indústria) e III (serviços).
const ANEXO: Record<Atividade, FaixaSimples[]> = {
  comercio: [
    { ate: 180_000,   aliq: 0.0400, deduzir: 0 },
    { ate: 360_000,   aliq: 0.0730, deduzir: 5_940 },
    { ate: 720_000,   aliq: 0.0950, deduzir: 13_860 },
    { ate: 1_800_000, aliq: 0.1070, deduzir: 22_500 },
    { ate: 3_600_000, aliq: 0.1430, deduzir: 87_300 },
    { ate: 4_800_000, aliq: 0.1900, deduzir: 378_000 },
  ],
  industria: [
    { ate: 180_000,   aliq: 0.0450, deduzir: 0 },
    { ate: 360_000,   aliq: 0.0780, deduzir: 5_940 },
    { ate: 720_000,   aliq: 0.1000, deduzir: 13_860 },
    { ate: 1_800_000, aliq: 0.1120, deduzir: 22_500 },
    { ate: 3_600_000, aliq: 0.1470, deduzir: 85_500 },
    { ate: 4_800_000, aliq: 0.3000, deduzir: 720_000 },
  ],
  servico: [
    { ate: 180_000,   aliq: 0.0600, deduzir: 0 },
    { ate: 360_000,   aliq: 0.1120, deduzir: 9_360 },
    { ate: 720_000,   aliq: 0.1350, deduzir: 17_640 },
    { ate: 1_800_000, aliq: 0.1600, deduzir: 35_640 },
    { ate: 3_600_000, aliq: 0.2100, deduzir: 125_640 },
    { ate: 4_800_000, aliq: 0.3300, deduzir: 648_000 },
  ],
};

/** Partilha do DAS por faixa (fração de cada tributo dentro do total) — LC 123. */
type Partilha = { irpj: number; csll: number; cofins: number; pis: number; cpp: number; icmsIss: number };
const PARTILHA: Record<Atividade, Partilha[]> = {
  // Anexo I — ICMS no campo icmsIss
  comercio: [
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4150, icmsIss: 0.3400 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4150, icmsIss: 0.3400 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4200, icmsIss: 0.3350 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4200, icmsIss: 0.3350 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1274, pis: 0.0276, cpp: 0.4200, icmsIss: 0.3350 },
    { irpj: 0.1350, csll: 0.1000, cofins: 0.2827, pis: 0.0613, cpp: 0.4210, icmsIss: 0.0000 },
  ],
  // Anexo II — ICMS no icmsIss (IPI omitido p/ simplificar; embutido implicitamente)
  industria: [
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, icmsIss: 0.3200 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, icmsIss: 0.3200 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, icmsIss: 0.3200 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, icmsIss: 0.3200 },
    { irpj: 0.0550, csll: 0.0350, cofins: 0.1151, pis: 0.0249, cpp: 0.3750, icmsIss: 0.3200 },
    { irpj: 0.0850, csll: 0.0750, cofins: 0.2096, pis: 0.0454, cpp: 0.2350, icmsIss: 0.0000 },
  ],
  // Anexo III — ISS no icmsIss
  servico: [
    { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, cpp: 0.4340, icmsIss: 0.3350 },
    { irpj: 0.0400, csll: 0.0350, cofins: 0.1405, pis: 0.0305, cpp: 0.4340, icmsIss: 0.3200 },
    { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, cpp: 0.4340, icmsIss: 0.3250 },
    { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, cpp: 0.4340, icmsIss: 0.3250 },
    { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, cpp: 0.4340, icmsIss: 0.3350 },
    { irpj: 0.3500, csll: 0.1500, cofins: 0.1603, pis: 0.0347, cpp: 0.3050, icmsIss: 0.0000 },
  ],
};

const ROTULO_ATIVIDADE: Record<Atividade, string> = {
  comercio: 'Comércio (Anexo I)',
  industria: 'Indústria (Anexo II)',
  servico: 'Serviços (Anexo III)',
};

export const OBS_ESCOPO =
  'Comparação dos tributos FEDERAIS (IRPJ, CSLL, PIS, COFINS). No Simples, o DAS ' +
  'também embute CPP (INSS patronal) e ICMS/ISS — mostrados na partilha. ICMS/ISS ' +
  'e folha não entram no Presumido/Real (são iguais nos dois e dependem da folha).';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const r2 = (n: number) => Math.round(n * 100) / 100;

function adicionalIrpj(base: number): number {
  return ADICIONAL_IRPJ * Math.max(0, base - ADICIONAL_IRPJ_LIMITE);
}

function faixaSimples(rbt12: number, atividade: Atividade): { faixa: FaixaSimples; indice: number } {
  const tabela = ANEXO[atividade];
  const indice = tabela.findIndex(f => rbt12 <= f.ate);
  const i = indice === -1 ? tabela.length - 1 : indice;
  return { faixa: tabela[i], indice: i };
}

/* ─── Lucro Presumido ────────────────────────────────────────────────────── */

export function simularLucroPresumido(e: EntradaSimulacao): RegimeSimulado {
  const { receitaBruta: rb, atividade } = e;
  const pres = PRESUNCAO[atividade];

  const baseIrpj = rb * pres.irpj;
  const irpjBase = baseIrpj * ALIQ_IRPJ;
  const irpjAdic = adicionalIrpj(baseIrpj);
  const irpj = irpjBase + irpjAdic;

  const baseCsll = rb * pres.csll;
  const csll = baseCsll * ALIQ_CSLL;

  const pis = rb * PIS_CUMULATIVO;
  const cofins = rb * COFINS_CUMULATIVO;

  const tributos: TributoLinha[] = [
    {
      sigla: 'IRPJ', nome: 'Imposto de Renda PJ', valor: r2(irpj),
      memoria: [
        { rotulo: 'Base presumida', formula: `Receita ${fmtPctMem(pres.irpj)} × presunção`, valor: r2(baseIrpj) },
        { rotulo: 'IRPJ 15%', formula: `Base × 15%`, valor: r2(irpjBase) },
        { rotulo: 'Adicional 10%', formula: `10% sobre o que excede R$ 240 mil/ano`, valor: r2(irpjAdic) },
      ],
    },
    {
      sigla: 'CSLL', nome: 'Contribuição Social', valor: r2(csll),
      memoria: [
        { rotulo: 'Base presumida', formula: `Receita × ${fmtPctMem(pres.csll)}`, valor: r2(baseCsll) },
        { rotulo: 'CSLL 9%', formula: `Base × 9%`, valor: r2(csll) },
      ],
    },
    {
      sigla: 'PIS', nome: 'PIS (cumulativo)', valor: r2(pis),
      memoria: [{ rotulo: 'PIS 0,65%', formula: `Receita × 0,65%`, valor: r2(pis) }],
    },
    {
      sigla: 'COFINS', nome: 'COFINS (cumulativo)', valor: r2(cofins),
      memoria: [{ rotulo: 'COFINS 3%', formula: `Receita × 3%`, valor: r2(cofins) }],
    },
  ];

  const totalFederal = r2(irpj + csll + pis + cofins);
  return {
    regime: 'lucro_presumido', rotulo: 'Lucro Presumido', elegivel: true,
    totalFederal, cargaEfetiva: rb > 0 ? totalFederal / rb : null,
    tributos, estimado: false,
    observacoes: [`Presunção ${ROTULO_ATIVIDADE[atividade].split(' (')[0]}: IRPJ ${fmtPctMem(pres.irpj)}, CSLL ${fmtPctMem(pres.csll)}.`],
  };
}

/* ─── Lucro Real ─────────────────────────────────────────────────────────── */

export function simularLucroReal(e: EntradaSimulacao): RegimeSimulado {
  const { receitaBruta: rb } = e;
  const estimado = e.lairContabil === null;
  const lair = e.lairContabil ?? (e.margemProxy !== null ? rb * e.margemProxy : 0);
  const lairPositivo = Math.max(0, lair);

  const irpjBase = lairPositivo * ALIQ_IRPJ;
  const irpjAdic = adicionalIrpj(lairPositivo);
  const irpj = irpjBase + irpjAdic;
  const csll = lairPositivo * ALIQ_CSLL;
  const pis = rb * PIS_NAO_CUMULATIVO;
  const cofins = rb * COFINS_NAO_CUMULATIVO;

  const baseMem: PassoMemoria[] = estimado
    ? [{ rotulo: 'Lucro estimado (margem-proxy)', formula: `Receita × ${e.margemProxy !== null ? fmtPctMem(e.margemProxy) : '—'}`, valor: r2(lair) }]
    : [{ rotulo: 'Lucro antes do IRPJ/CSLL (ECF)', valor: r2(lair) }];

  const tributos: TributoLinha[] = [
    {
      sigla: 'IRPJ', nome: 'Imposto de Renda PJ', valor: r2(irpj),
      memoria: [
        ...baseMem,
        { rotulo: 'IRPJ 15%', formula: `Lucro × 15%`, valor: r2(irpjBase) },
        { rotulo: 'Adicional 10%', formula: `10% sobre o que excede R$ 240 mil/ano`, valor: r2(irpjAdic) },
      ],
    },
    {
      sigla: 'CSLL', nome: 'Contribuição Social', valor: r2(csll),
      memoria: [...baseMem, { rotulo: 'CSLL 9%', formula: `Lucro × 9%`, valor: r2(csll) }],
    },
    {
      sigla: 'PIS', nome: 'PIS (não-cumulativo)', valor: r2(pis),
      memoria: [{ rotulo: 'PIS 1,65%', formula: `Receita × 1,65% (sem créditos)`, valor: r2(pis) }],
    },
    {
      sigla: 'COFINS', nome: 'COFINS (não-cumulativo)', valor: r2(cofins),
      memoria: [{ rotulo: 'COFINS 7,6%', formula: `Receita × 7,6% (sem créditos)`, valor: r2(cofins) }],
    },
  ];

  const totalFederal = r2(irpj + csll + pis + cofins);
  const observacoes = [
    'PIS/COFINS não-cumulativo calculado SEM créditos de insumos — é teto; o efetivo tende a ser menor.',
  ];
  if (estimado) observacoes.unshift('Sem ECF de Lucro Real: lucro estimado por margem — valor indicativo.');

  return {
    regime: 'lucro_real', rotulo: 'Lucro Real', elegivel: true,
    totalFederal, cargaEfetiva: rb > 0 ? totalFederal / rb : null,
    tributos, estimado, observacoes,
  };
}

/* ─── Simples Nacional ───────────────────────────────────────────────────── */

export function simularSimplesNacional(e: EntradaSimulacao): RegimeSimulado {
  const { receitaBruta: rb, atividade } = e;

  if (rb > TETO_SIMPLES) {
    return {
      regime: 'simples_nacional', rotulo: 'Simples Nacional', elegivel: false,
      totalFederal: null, totalUnificado: null, cargaEfetiva: null, tributos: [], estimado: false,
      observacoes: [`Receita de ${fmtMoedaMem(rb)} excede o teto de R$ 4,8 mi — empresa NÃO é elegível ao Simples.`],
    };
  }

  const { faixa, indice } = faixaSimples(rb, atividade);
  const aliqEfetiva = (rb * faixa.aliq - faixa.deduzir) / rb;
  const das = rb * aliqEfetiva;
  const part = PARTILHA[atividade][indice];
  const labelIcmsIss = atividade === 'servico' ? 'ISS' : 'ICMS';

  const linha = (sigla: string, nome: string, frac: number): TributoLinha => ({
    sigla, nome, valor: r2(das * frac), partilha: frac,
    memoria: [{ rotulo: `${fmtPctMem(frac)} do DAS`, formula: `DAS × ${fmtPctMem(frac)}`, valor: r2(das * frac) }],
  });

  const tributos: TributoLinha[] = [
    linha('IRPJ', 'Imposto de Renda PJ', part.irpj),
    linha('CSLL', 'Contribuição Social', part.csll),
    linha('COFINS', 'COFINS', part.cofins),
    linha('PIS', 'PIS/Pasep', part.pis),
    linha('CPP', 'INSS patronal (CPP)', part.cpp),
    linha(labelIcmsIss, labelIcmsIss === 'ISS' ? 'ISS' : 'ICMS', part.icmsIss),
  ];

  const totalFederal = r2(das * (part.irpj + part.csll + part.cofins + part.pis));
  const totalUnificado = r2(das);

  return {
    regime: 'simples_nacional', rotulo: 'Simples Nacional', elegivel: true,
    totalFederal, totalUnificado, cargaEfetiva: rb > 0 ? totalFederal / rb : null,
    tributos, estimado: false,
    observacoes: [
      `${ROTULO_ATIVIDADE[atividade]}, faixa ${indice + 1}: alíquota nominal ${fmtPctMem(faixa.aliq)}, ` +
        `efetiva ${fmtPctMem(aliqEfetiva)} (parcela a deduzir ${fmtMoedaMem(faixa.deduzir)}).`,
      `DAS total ${fmtMoedaMem(das)} — embute CPP e ${labelIcmsIss} (ver partilha). Comparação usa só a fatia federal.`,
      'Fator R (folha) não considerado — Anexo definido pela atividade.',
    ],
  };
}

/* ─── Orquestrador ───────────────────────────────────────────────────────── */

export function simularRegimes(e: EntradaSimulacao): ResultadoSimulacao {
  const regimes = [
    simularSimplesNacional(e),
    simularLucroPresumido(e),
    simularLucroReal(e),
  ];

  // Recomendação: menor carga FEDERAL entre os elegíveis.
  const elegiveis = regimes.filter(r => r.elegivel && r.totalFederal !== null);
  const recomendadoR = elegiveis.reduce<RegimeSimulado | null>(
    (best, r) => (best === null || (r.totalFederal as number) < (best.totalFederal as number) ? r : best),
    null,
  );
  const recomendado = recomendadoR?.regime ?? null;

  const atual = e.regimeAtual ? regimes.find(r => r.regime === e.regimeAtual) : null;
  const economiaVsAtual =
    atual && atual.totalFederal !== null && recomendadoR?.totalFederal != null
      ? r2(atual.totalFederal - recomendadoR.totalFederal)
      : null;

  return {
    receitaBruta: e.receitaBruta,
    atividade: e.atividade,
    regimeAtual: e.regimeAtual,
    regimes,
    recomendado,
    economiaVsAtual,
    premissas: [
      OBS_ESCOPO,
      `Atividade considerada: ${ROTULO_ATIVIDADE[e.atividade]}.`,
      'IRPJ: 15% + adicional de 10% sobre o lucro/base que excede R$ 240 mil/ano. CSLL: 9%.',
    ],
  };
}

/* ─── Formatação só p/ texto da memória (independe da UI) ─────────────────── */

function fmtPctMem(frac: number): string {
  return `${(frac * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}
function fmtMoedaMem(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
