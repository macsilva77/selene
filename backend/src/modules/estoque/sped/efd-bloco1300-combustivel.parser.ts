/**
 * Parser do BLOCO 1 — combustíveis (registros 1300/1310/1320) do EFD ICMS/IPI.
 * É o Livro de Movimentação de Combustíveis (LMC) digital — o estoque fiscal MEDIDO do posto.
 *
 * Fonte do leiaute: Guia Prático EFD-ICMS/IPI v3.2.2, págs. 293-295.
 *   1300 — Movimentação diária por combustível (1 por COD_ITEM + DT_FECH)
 *          |1300|COD_ITEM|DT_FECH|ESTQ_ABERT|VOL_ENTR|VOL_DISP|VOL_SAIDAS|ESTQ_ESCR|VAL_AJ_PERDA|VAL_AJ_GANHO|FECH_FISICO|
 *   1310 — Movimentação diária por tanque
 *          |1310|NUM_TANQUE|ESTQ_ABERT|VOL_ENTR|VOL_DISP|VOL_SAIDAS|ESTQ_ESCR|VAL_AJ_PERDA|VAL_AJ_GANHO|FECH_FISICO|CAP_TANQUE|
 *   1320 — Volume de vendas por bico   |1320|NUM_BICO|...|VOL_VENDAS|
 *
 * Todos os volumes em LITROS. Validação oficial: Σ FECH_FISICO(1310) = FECH_FISICO(1300);
 * e o FECH_FISICO do último dia do ano casa com o Bloco H de 31/12.
 */
import { iterLines, parseNum, isoData } from './efd-bloco-h.parser';

export interface CombustivelMovimento {
  codItem: string;
  descricao: string;   // do 0200
  ncm: string;
  dias: number;        // dias com registro 1300
  dtAbertura: string;  // 1ª data (ISO)
  dtFechamento: string;// última data (ISO)
  estqAbertura: number;// ESTQ_ABERT do 1º dia
  estqFechamento: number; // FECH_FISICO do último dia
  volEntradas: number; // Σ VOL_ENTR
  volSaidas: number;   // Σ VOL_SAIDAS (venda medida)
  perda: number;       // Σ VAL_AJ_PERDA
  ganho: number;       // Σ VAL_AJ_GANHO
}

export interface TanqueMovimento {
  numTanque: string;
  volSaidas: number;
  perda: number;
  ganho: number;
  capacidade: number;
}

export interface MovimentoCombustivel {
  cnpj: string;
  dtIni: string;
  dtFin: string;
  combustiveis: Map<string, CombustivelMovimento>;
  tanques: Map<string, TanqueMovimento>;
  temBloco1300: boolean;
}

const IDX_0000 = { DT_INI: 4, DT_FIN: 5, CNPJ: 7 } as const;
const IDX_0200 = { COD_ITEM: 2, DESCR: 3, NCM: 8 } as const;
// 1300: |1300|COD_ITEM|DT_FECH|ESTQ_ABERT|VOL_ENTR|VOL_DISP|VOL_SAIDAS|ESTQ_ESCR|VAL_AJ_PERDA|VAL_AJ_GANHO|FECH_FISICO|
const I1300 = { COD_ITEM: 2, DT_FECH: 3, ESTQ_ABERT: 4, VOL_ENTR: 5, VOL_SAIDAS: 7, PERDA: 9, GANHO: 10, FECH_FISICO: 11 } as const;
// 1310: |1310|NUM_TANQUE|ESTQ_ABERT|VOL_ENTR|VOL_DISP|VOL_SAIDAS|ESTQ_ESCR|VAL_AJ_PERDA|VAL_AJ_GANHO|FECH_FISICO|CAP_TANQUE|
const I1310 = { NUM_TANQUE: 2, VOL_SAIDAS: 6, PERDA: 8, GANHO: 9, FECH_FISICO: 10, CAP_TANQUE: 11 } as const;

export function parseEfdBloco1300(buffer: Buffer): MovimentoCombustivel {
  const cab = { cnpj: '', dtIni: '', dtFin: '' };
  const catalogo = new Map<string, { descr: string; ncm: string }>();
  const combustiveis = new Map<string, CombustivelMovimento>();
  const tanques = new Map<string, TanqueMovimento>();
  let temBloco1300 = false;

  for (const raw of iterLines(buffer)) {
    const f = raw.split('|');
    const reg = f[1];

    switch (reg) {
      case '0000':
        cab.cnpj = (f[IDX_0000.CNPJ] ?? '').replace(/\D/g, '').padStart(14, '0');
        cab.dtIni = isoData(f[IDX_0000.DT_INI]);
        cab.dtFin = isoData(f[IDX_0000.DT_FIN]);
        break;

      case '0200': {
        const cod = f[IDX_0200.COD_ITEM] ?? '';
        if (cod) catalogo.set(cod, { descr: (f[IDX_0200.DESCR] ?? '').trim(), ncm: (f[IDX_0200.NCM] ?? '').trim() });
        break;
      }

      case '1300': {
        temBloco1300 = true;
        const cod = (f[I1300.COD_ITEM] ?? '').trim();
        if (!cod) break;
        const data = isoData(f[I1300.DT_FECH]);
        const c = combustiveis.get(cod) ?? novoCombustivel(cod);
        // primeiro dia → estoque de abertura; último dia → fechamento físico
        if (!c.dtAbertura || data < c.dtAbertura) { c.dtAbertura = data; c.estqAbertura = parseNum(f[I1300.ESTQ_ABERT]); }
        if (data >= c.dtFechamento) { c.dtFechamento = data; c.estqFechamento = parseNum(f[I1300.FECH_FISICO]); }
        c.dias += 1;
        c.volEntradas += parseNum(f[I1300.VOL_ENTR]);
        c.volSaidas += parseNum(f[I1300.VOL_SAIDAS]);
        c.perda += parseNum(f[I1300.PERDA]);
        c.ganho += parseNum(f[I1300.GANHO]);
        combustiveis.set(cod, c);
        break;
      }

      case '1310': {
        const num = (f[I1310.NUM_TANQUE] ?? '').trim();
        if (!num) break;
        const t = tanques.get(num) ?? { numTanque: num, volSaidas: 0, perda: 0, ganho: 0, capacidade: 0 };
        t.volSaidas += parseNum(f[I1310.VOL_SAIDAS]);
        t.perda += parseNum(f[I1310.PERDA]);
        t.ganho += parseNum(f[I1310.GANHO]);
        t.capacidade = Math.max(t.capacidade, parseNum(f[I1310.CAP_TANQUE]));
        tanques.set(num, t);
        break;
      }

      default:
        break;
    }
  }

  for (const [cod, c] of combustiveis) {
    const cat = catalogo.get(cod);
    if (cat) { c.descricao = cat.descr; c.ncm = cat.ncm; }
  }

  return { cnpj: cab.cnpj, dtIni: cab.dtIni, dtFin: cab.dtFin, combustiveis, tanques, temBloco1300 };
}

/** Soma vários meses num único movimento anual por combustível. */
export function agregarCombustivel(movs: MovimentoCombustivel[]): MovimentoCombustivel {
  const combustiveis = new Map<string, CombustivelMovimento>();
  const tanques = new Map<string, TanqueMovimento>();
  let temBloco1300 = false, cnpj = '', dtIni = '', dtFin = '';

  for (const m of movs) {
    cnpj = cnpj || m.cnpj;
    dtIni = !dtIni || (m.dtIni && m.dtIni < dtIni) ? m.dtIni : dtIni;
    dtFin = m.dtFin > dtFin ? m.dtFin : dtFin;
    temBloco1300 = temBloco1300 || m.temBloco1300;
    for (const [cod, src] of m.combustiveis) {
      const c = combustiveis.get(cod) ?? novoCombustivel(cod);
      if (!c.dtAbertura || (src.dtAbertura && src.dtAbertura < c.dtAbertura)) { c.dtAbertura = src.dtAbertura; c.estqAbertura = src.estqAbertura; }
      if (src.dtFechamento >= c.dtFechamento) { c.dtFechamento = src.dtFechamento; c.estqFechamento = src.estqFechamento; }
      c.dias += src.dias;
      c.volEntradas += src.volEntradas; c.volSaidas += src.volSaidas;
      c.perda += src.perda; c.ganho += src.ganho;
      if (src.descricao && !c.descricao) c.descricao = src.descricao;
      if (src.ncm && !c.ncm) c.ncm = src.ncm;
      combustiveis.set(cod, c);
    }
    for (const [num, src] of m.tanques) {
      const t = tanques.get(num) ?? { numTanque: num, volSaidas: 0, perda: 0, ganho: 0, capacidade: 0 };
      t.volSaidas += src.volSaidas; t.perda += src.perda; t.ganho += src.ganho;
      t.capacidade = Math.max(t.capacidade, src.capacidade);
      tanques.set(num, t);
    }
  }
  return { cnpj, dtIni, dtFin, combustiveis, tanques, temBloco1300 };
}

function novoCombustivel(codItem: string): CombustivelMovimento {
  return { codItem, descricao: '', ncm: '', dias: 0, dtAbertura: '', dtFechamento: '', estqAbertura: 0, estqFechamento: 0, volEntradas: 0, volSaidas: 0, perda: 0, ganho: 0 };
}
