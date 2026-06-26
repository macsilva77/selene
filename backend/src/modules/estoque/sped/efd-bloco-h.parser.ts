/**
 * Parser do BLOCO H (Inventário Físico) do EFD ICMS/IPI.
 *
 * Fonte do leiaute: Guia Prático EFD-ICMS/IPI v3.2.2 (atualização 11/02/2026), págs. 260-264.
 *
 * O Bloco H é a FOTO do estoque numa data (DT_INV) — a âncora do estoque fiscal.
 * Registros:
 *   H001 — abertura            |H001|IND_MOV|                         (0=com dados, 1=sem)
 *   H005 — totais (1:N)        |H005|DT_INV|VL_INV|MOT_INV|
 *   H010 — item   (1:N)        |H010|COD_ITEM|UNID|QTD|VL_UNIT|VL_ITEM|IND_PROP|COD_PART|TXT_COMPL|COD_CTA|VL_ITEM_IR|
 *   H020 — compl. ICMS (1:1)   |H020|CST_ICMS|BC_ICMS|VL_ICMS|        (só quando MOT_INV de 02 a 05)
 *   H030 — compl. ST   (1:1)   |H030|VL_ICMS_OP|VL_BC_ICMS_ST|VL_ICMS_ST|VL_FCP|  (só quando MOT_INV=06)
 *   H990 — encerramento        |H990|QTD_LIN_H|
 *
 * Apoio (de outros blocos, necessários para enriquecer o item):
 *   0000 — abertura            |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|...
 *   0150 — participante        |0150|COD_PART|NOME|COD_PAIS|CNPJ|...           (dono/possuidor terceiro)
 *   0200 — catálogo do item    |0200|COD_ITEM|DESCR_ITEM|COD_BARRA|COD_ANT|UNID_INV|TIPO_ITEM|COD_NCM|...
 *
 * Regras do guia aplicadas:
 *   - VL_INV (H005) deve ser igual à soma de VL_ITEM dos H010 → checagem de integridade.
 *   - IND_PROP ∈ {0,1,2}; se 1 ou 2, COD_PART é obrigatório.
 *   - H020 só existe para MOT_INV 02-05; H030 só para MOT_INV 06.
 */

export type MotivoInventario = '01' | '02' | '03' | '04' | '05' | '06';
export type IndProp = '0' | '1' | '2';

export interface ItemInventario {
  codItem: string;
  descricao: string;            // do 0200 (vazio se item sem catálogo)
  ncm: string;                  // do 0200
  unid: string;                 // H010 (UNID)
  qtd: number;
  vlUnit: number;
  vlItem: number;
  indProp: IndProp;
  codPart: string | null;
  participante: string | null;  // nome do 0150 (quando IND_PROP ≠ 0)
  codCta: string | null;
  vlItemIr: number | null;
  // Complementos opcionais (H020 — MOT_INV 02-05)
  cstIcms?: string;
  bcIcms?: number;
  vlIcms?: number;
  // Complementos opcionais (H030 — MOT_INV 06, ST)
  vlIcmsOp?: number;
  vlBcIcmsSt?: number;
  vlIcmsSt?: number;
  vlFcp?: number;
  // Sinalização de integridade do próprio item
  semCatalogo: boolean;         // COD_ITEM ausente no 0200
}

export interface Inventario {
  dtInv: string;                // ISO yyyy-mm-dd
  motInv: MotivoInventario;
  vlInvDeclarado: number;       // VL_INV do H005
  somaVlItem: number;           // Σ VL_ITEM calculado
  integridadeOk: boolean;       // |declarado − soma| ≤ tolerância
  itens: ItemInventario[];
}

export interface InventarioBlocoH {
  cnpj: string;
  dtIni: string;                // ISO — DT_INI do 0000
  dtFin: string;                // ISO — DT_FIN do 0000
  temBlocoH: boolean;           // H001 IND_MOV = 0
  inventarios: Inventario[];    // um por H005 (relação 1:N)
}

// ── índices após split('|'): fields[0] vazio, fields[1] = REG ──
const IDX_0000 = { DT_INI: 4, DT_FIN: 5, CNPJ: 7 } as const;
const IDX_0150 = { COD_PART: 2, NOME: 3 } as const;
const IDX_0200 = { COD_ITEM: 2, DESCR: 3, UNID_INV: 6, NCM: 8 } as const;
const IDX_H005 = { DT_INV: 2, VL_INV: 3, MOT_INV: 4 } as const;
const IDX_H010 = {
  COD_ITEM: 2, UNID: 3, QTD: 4, VL_UNIT: 5, VL_ITEM: 6,
  IND_PROP: 7, COD_PART: 8, TXT_COMPL: 9, COD_CTA: 10, VL_ITEM_IR: 11,
} as const;
const IDX_H020 = { CST_ICMS: 2, BC_ICMS: 3, VL_ICMS: 4 } as const;
const IDX_H030 = { VL_ICMS_OP: 2, VL_BC_ICMS_ST: 3, VL_ICMS_ST: 4, VL_FCP: 5 } as const;

const TOLERANCIA_INTEGRIDADE = 0.01; // centavos

export function parseEfdBlocoH(buffer: Buffer): InventarioBlocoH {
  const cab = { cnpj: '', dtIni: '', dtFin: '' };
  let temBlocoH = false;
  const participantes = new Map<string, string>();              // codPart → nome
  const catalogo = new Map<string, { descr: string; ncm: string }>(); // codItem → {descr, ncm}
  const inventarios: Inventario[] = [];

  let invAtual: Inventario | null = null;
  let itemAtual: ItemInventario | null = null;

  for (const raw of iterLines(buffer)) {
    const f = raw.split('|');
    const reg = f[1];

    switch (reg) {
      case '0000':
        cab.cnpj = (f[IDX_0000.CNPJ] ?? '').replace(/\D/g, '').padStart(14, '0');
        cab.dtIni = isoData(f[IDX_0000.DT_INI]);
        cab.dtFin = isoData(f[IDX_0000.DT_FIN]);
        break;

      case '0150': {
        const cod = f[IDX_0150.COD_PART] ?? '';
        if (cod) participantes.set(cod, (f[IDX_0150.NOME] ?? '').trim());
        break;
      }

      case '0200': {
        const cod = f[IDX_0200.COD_ITEM] ?? '';
        if (cod) {
          catalogo.set(cod, {
            descr: (f[IDX_0200.DESCR] ?? '').trim(),
            ncm: (f[IDX_0200.NCM] ?? '').trim(),
          });
        }
        break;
      }

      case 'H001':
        temBlocoH = (f[2] ?? '') === '0';
        break;

      case 'H005': {
        invAtual = {
          dtInv: isoData(f[IDX_H005.DT_INV]),
          motInv: normalizaMotivo(f[IDX_H005.MOT_INV]),
          vlInvDeclarado: parseNum(f[IDX_H005.VL_INV]),
          somaVlItem: 0,
          integridadeOk: false,
          itens: [],
        };
        itemAtual = null;
        inventarios.push(invAtual);
        break;
      }

      case 'H010': {
        if (!invAtual) break; // H010 órfão (sem H005) — ignora
        const indProp = normalizaIndProp(f[IDX_H010.IND_PROP]);
        const codPart = (f[IDX_H010.COD_PART] ?? '').trim() || null;
        itemAtual = {
          codItem: (f[IDX_H010.COD_ITEM] ?? '').trim(),
          descricao: '',
          ncm: '',
          unid: (f[IDX_H010.UNID] ?? '').trim(),
          qtd: parseNum(f[IDX_H010.QTD]),
          vlUnit: parseNum(f[IDX_H010.VL_UNIT]),
          vlItem: parseNum(f[IDX_H010.VL_ITEM]),
          indProp,
          codPart,
          participante: codPart ? participantes.get(codPart) ?? null : null,
          codCta: (f[IDX_H010.COD_CTA] ?? '').trim() || null,
          vlItemIr: f[IDX_H010.VL_ITEM_IR] ? parseNum(f[IDX_H010.VL_ITEM_IR]) : null,
          semCatalogo: false,
        };
        invAtual.itens.push(itemAtual);
        break;
      }

      case 'H020': {
        if (!itemAtual) break;
        itemAtual.cstIcms = (f[IDX_H020.CST_ICMS] ?? '').trim();
        itemAtual.bcIcms = parseNum(f[IDX_H020.BC_ICMS]);
        itemAtual.vlIcms = parseNum(f[IDX_H020.VL_ICMS]);
        break;
      }

      case 'H030': {
        if (!itemAtual) break;
        itemAtual.vlIcmsOp = parseNum(f[IDX_H030.VL_ICMS_OP]);
        itemAtual.vlBcIcmsSt = parseNum(f[IDX_H030.VL_BC_ICMS_ST]);
        itemAtual.vlIcmsSt = parseNum(f[IDX_H030.VL_ICMS_ST]);
        itemAtual.vlFcp = parseNum(f[IDX_H030.VL_FCP]);
        break;
      }

      default:
        break;
    }
  }

  // enriquece itens com catálogo (0150 já resolvido na criação) e fecha integridade
  for (const inv of inventarios) {
    let soma = 0;
    for (const it of inv.itens) {
      const cat = catalogo.get(it.codItem);
      if (cat) { it.descricao = cat.descr; it.ncm = cat.ncm; }
      else it.semCatalogo = true;
      // participante pode ter sido cadastrado depois do H010 — resolve no fim
      if (it.codPart && !it.participante) it.participante = participantes.get(it.codPart) ?? null;
      soma += it.vlItem;
    }
    inv.somaVlItem = round2(soma);
    inv.integridadeOk = Math.abs(inv.somaVlItem - inv.vlInvDeclarado) <= TOLERANCIA_INTEGRIDADE;
  }

  return { cnpj: cab.cnpj, dtIni: cab.dtIni, dtFin: cab.dtFin, temBlocoH, inventarios };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Itera linhas do buffer latin1 sem materializar a string inteira (pico ~1× o arquivo). */
export function* iterLines(buf: Buffer): Generator<string> {
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const end = i > 0 && buf[i - 1] === 0x0d ? i - 1 : i;
      if (end > start) yield buf.toString('latin1', start, end);
      start = i + 1;
    }
  }
  if (start < buf.length) yield buf.toString('latin1', start);
}

/** Número no formato SPED: vírgula decimal, sem separador de milhar. */
export function parseNum(s: string | undefined): number {
  const str = (s ?? '').trim();
  if (!str) return 0;
  const v = Number.parseFloat(str.includes(',') ? str.replace(',', '.') : str);
  return Number.isNaN(v) ? 0 : v;
}

/** 'ddmmaaaa' → 'aaaa-mm-dd'. Retorna '' se inválido. */
export function isoData(s: string | undefined): string {
  const str = (s ?? '').trim();
  if (!/^\d{8}$/.test(str)) return '';
  return `${str.slice(4, 8)}-${str.slice(2, 4)}-${str.slice(0, 2)}`;
}

function normalizaMotivo(s: string | undefined): MotivoInventario {
  const m = (s ?? '').trim().padStart(2, '0');
  return (['01', '02', '03', '04', '05', '06'].includes(m) ? m : '01') as MotivoInventario;
}

function normalizaIndProp(s: string | undefined): IndProp {
  const v = (s ?? '').trim();
  return (v === '1' || v === '2' ? v : '0') as IndProp;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
