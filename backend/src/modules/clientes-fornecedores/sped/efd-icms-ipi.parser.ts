/**
 * Parser de EFD ICMS/IPI — fonte exclusiva de Blocos C e D.
 *
 * Registros utilizados:
 *   0150 — Cadastro do Participante (CNPJ, razão social)
 *   C100 — Documentos Fiscais de mercadorias (NF-e mod. 55/01)
 *   D100 — Documentos de serviços de transporte com ICMS (CT-e)
 *
 * Regra: COD_SIT = "00" → documento válido.
 *        IND_OPER = 0 → FORNECEDOR (entrada/compra)
 *        IND_OPER = 1 → CLIENTE   (saída/venda)
 *
 * Layout (pipe-delimitado, latin1) — Guia Prático EFD ICMS/IPI v3.x (2024+):
 *   |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|...|
 *   |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...|
 *   |D100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC|CHV_CTE|DT_DOC|DT_A_P|TP_CT-e|CHAVE_CTE_REF|VL_DOC|...|
 *
 * Nota D100: TP_CT-e (idx 13) e CHAVE_CTE_REF (idx 14) foram incluídos a partir da versão 13
 * do leiaute (portaria 2018). Arquivos gerados por versões anteriores colocam VL_DOC em idx 13.
 * O sistema suporta apenas arquivos v13+. Arquivos legados devem ser reprocessados.
 */

export interface FatoParticipante {
  codPart: string;
  cnpj: string;
  cnpjRaiz: string;
  razaoSocial: string;
  tipoParticipante: 'CLIENTE' | 'FORNECEDOR';
  valorTotal: number;
  quantidadeDocumentos: number;
}

interface Participante {
  nome: string;
  cnpj: string;
  cnpjRaiz: string;
}

// Índices após split('|') — fields[0] vazio (antes do primeiro |), fields[1] = REG
const IDX_0150 = { COD_PART: 2, NOME: 3, CNPJ: 5 } as const;

// C100: |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...|
const IDX_C100 = { IND_OPER: 2, COD_PART: 4, COD_SIT: 6, VL_DOC: 12 } as const;

// D100: |D100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC|CHV_CTE|DT_DOC|DT_A_P|TP_CT-e|CHAVE_CTE_REF|VL_DOC|...|
const IDX_D100 = { IND_OPER: 2, COD_PART: 4, COD_SIT: 6, VL_DOC: 15 } as const;

export function parseEfdIcmsIpi(buffer: Buffer): FatoParticipante[] {
  const participantes = new Map<string, Participante>();
  // chave: `${codPart}|${CLIENTE|FORNECEDOR}`
  const agregados = new Map<string, { valor: number; qtd: number }>();

  for (const raw of iterLines(buffer)) {
    const fields = raw.split('|');
    const reg = fields[1];

    if (reg === '0150') {
      const codPart = fields[IDX_0150.COD_PART] ?? '';
      if (!codPart) continue;
      const nome = fields[IDX_0150.NOME] ?? '';
      const cnpj = (fields[IDX_0150.CNPJ] ?? '').replace(/\D/g, '').padStart(14, '0');
      participantes.set(codPart, { nome, cnpj, cnpjRaiz: cnpj.slice(0, 8) });

    } else if (reg === 'C100') {
      acumular(fields, IDX_C100.IND_OPER, IDX_C100.COD_PART, IDX_C100.COD_SIT, IDX_C100.VL_DOC, agregados);

    } else if (reg === 'D100') {
      acumular(fields, IDX_D100.IND_OPER, IDX_D100.COD_PART, IDX_D100.COD_SIT, IDX_D100.VL_DOC, agregados);
    }
  }

  return consolidar(participantes, agregados);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Itera linhas do buffer latin1 sem criar a string gigante intermediária.
 * Reduz pico de memória de ~3× para ~1× o tamanho do arquivo.
 */
export function* iterLines(buf: Buffer): Generator<string> {
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      // strip \r de \r\n
      const end = i > 0 && buf[i - 1] === 0x0d ? i - 1 : i;
      if (end > start) yield buf.toString('latin1', start, end);
      start = i + 1;
    }
  }
  if (start < buf.length) yield buf.toString('latin1', start);
}

function acumular(
  fields: string[],
  idxOper: number,
  idxPart: number,
  idxSit: number,
  idxVal: number,
  agregados: Map<string, { valor: number; qtd: number }>,
): void {
  const codSit = fields[idxSit] ?? '';
  if (codSit !== '00') return;

  const codPart = fields[idxPart] ?? '';
  if (!codPart) return;

  const tipo: 'CLIENTE' | 'FORNECEDOR' = (fields[idxOper] ?? '') === '1' ? 'CLIENTE' : 'FORNECEDOR';
  const vlDoc = parseBr(fields[idxVal] ?? '0');

  const key = `${codPart}|${tipo}`;
  const agg = agregados.get(key) ?? { valor: 0, qtd: 0 };
  agg.valor += vlDoc;
  agg.qtd += 1;
  agregados.set(key, agg);
}

function consolidar(
  participantes: Map<string, Participante>,
  agregados: Map<string, { valor: number; qtd: number }>,
): FatoParticipante[] {
  const result: FatoParticipante[] = [];
  for (const [key, { valor, qtd }] of agregados) {
    const pipeIdx = key.indexOf('|');
    const codPart = key.slice(0, pipeIdx);
    const tipo = key.slice(pipeIdx + 1) as 'CLIENTE' | 'FORNECEDOR';
    const part = participantes.get(codPart);
    if (!part) continue;
    result.push({ codPart, cnpj: part.cnpj, cnpjRaiz: part.cnpjRaiz, razaoSocial: part.nome, tipoParticipante: tipo, valorTotal: valor, quantidadeDocumentos: qtd });
  }
  return result;
}

export function parseBr(s: string): number {
  const str = (s ?? '').trim();
  if (!str) return 0;
  // Formato BR (1.500,00): vírgula presente → ponto é separador de milhar
  const normalized = str.includes(',')
    ? str.replaceAll('.', '').replace(',', '.')
    : str;
  const v = Number.parseFloat(normalized);
  return Number.isNaN(v) ? 0 : v;
}
