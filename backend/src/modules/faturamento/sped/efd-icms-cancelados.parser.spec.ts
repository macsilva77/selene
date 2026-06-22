import { Readable } from 'node:stream';
import { parseEfdIcmsCancelados } from './efd-icms-cancelados.parser';

function stream(lines: string[]): Readable {
  return Readable.from([Buffer.from(lines.join('\n'), 'latin1')]);
}
/** Atalho: só os documentos cancelados. */
const parseDocs = async (lines: string[]) => (await parseEfdIcmsCancelados(stream(lines))).docs;

const l0000 = (dtIni: string) => `|0000|9|0|${dtIni}|31012024|Empresa X|12345678000195|||SP||`;

// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...
const c100 = (codSit: string, vlDoc: string, indOper = '1', num = '000001', indEmit = '0') =>
  `|C100|${indOper}|${indEmit}|PART1|55|${codSit}|1|${num}|CHV${num}|15012024|15012024|${vlDoc}|0|0|0|0|0|0|0|0|0|0|0|0|`;

// |C800|COD_MOD|COD_SIT|NUM_CFE|DT_DOC|VL_CFE|VL_PIS|VL_COFINS|CNPJ_CPF|NR_SAT|CHV_CFE|
const c800 = (codSit: string, vlCfe: string, num = '000010') =>
  `|C800|65|${codSit}|${num}|15012024|${vlCfe}|0|0|||CHVSAT${num}|`;

describe('parseEfdIcmsCancelados', () => {
  it('coleta apenas C100 cancelados (02/03), ignorando válidos', async () => {
    const docs = await parseDocs([
      l0000('01012024'),
      c100('00', '1.000,00'),   // válido — ignorado (entra na base, não nos docs)
      c100('02', '5.000,00'),   // cancelado
      c100('03', '7.000,00'),   // cancelado extemporâneo
      c100('07', '9.000,00'),   // denegado — não é cancelamento
    ]);
    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.codSit).sort((a, b) => a.localeCompare(b))).toEqual(['02', '03']);
    expect(docs.find(d => d.codSit === '03')?.extemporaneo).toBe(true);
    expect(docs.find(d => d.codSit === '02')?.extemporaneo).toBe(false);
  });

  it('exclui C100 cancelado de TERCEIROS (IND_EMIT=1) — só emissão própria', async () => {
    const docs = await parseDocs([
      l0000('01012024'),
      c100('02', '1.000,00', '1', '000001', '0'),  // própria — conta
      c100('02', '2.000,00', '0', '000002', '1'),  // terceiros — ignorado
      c100('03', '3.000,00', '1', '000003', '1'),  // terceiros extemp — ignorado
    ]);
    expect(docs).toHaveLength(1);
    expect(docs[0].numDoc).toBe('000001');
  });

  it('captura competência, valor, indOper e chave do C100', async () => {
    const [d] = await parseDocs([
      l0000('01032025'),
      c100('02', '12.345,67', '1', '000099'),
    ]);
    expect(d.competencia).toBe('2025-03');
    expect(d.vlDoc).toBeCloseTo(12345.67, 2);
    expect(d.indOper).toBe('1');
    expect(d.tipo).toBe('NFe');
    expect(d.numDoc).toBe('000099');
    expect(d.chave).toBe('CHV000099');
  });

  it('distingue entrada (indOper=0) de saída (1)', async () => {
    const docs = await parseDocs([
      l0000('01012024'),
      c100('02', '1.000,00', '0'),  // entrada cancelada
      c100('02', '2.000,00', '1'),  // saída cancelada
    ]);
    expect(docs.find(d => d.indOper === '0')?.vlDoc).toBeCloseTo(1000, 2);
    expect(docs.find(d => d.indOper === '1')?.vlDoc).toBeCloseTo(2000, 2);
  });

  it('coleta C800 (SAT) cancelado como saída, com VL_CFE e chave', async () => {
    const docs = await parseDocs([
      l0000('01012024'),
      c800('00', '50,00'),     // regular — ignorado (base)
      c800('02', '80,00'),     // cancelado
    ]);
    expect(docs).toHaveLength(1);
    const d = docs[0];
    expect(d.tipo).toBe('SAT');
    expect(d.indOper).toBe('1');
    expect(d.vlDoc).toBeCloseTo(80, 2);
    expect(d.chave).toBe('CHVSAT000010');
  });

  it('arquivo sem cancelados retorna vazio', async () => {
    const docs = await parseDocs([
      l0000('01012024'),
      c100('00', '1.000,00'),
      c800('00', '50,00'),
    ]);
    expect(docs).toHaveLength(0);
  });

  it('conta saídas próprias VÁLIDAS (base da taxa) na mesma leitura', async () => {
    const r = await parseEfdIcmsCancelados(stream([
      l0000('01012024'),
      c100('00', '1.000,00', '1'),            // válida saída própria → base
      c100('01', '1.000,00', '1'),            // válida extemporânea saída → base
      c100('00', '1.000,00', '0'),            // válida ENTRADA própria → NÃO conta
      c100('00', '1.000,00', '1', 'x', '1'),  // válida saída TERCEIROS → NÃO conta
      c100('02', '5.000,00', '1'),            // cancelada → não é base
      c800('00', '50,00'),                    // SAT válida → base
      c800('02', '80,00'),                    // SAT cancelada → não é base
    ]));
    expect(r.competencia).toBe('2024-01');
    expect(r.validasSaida).toBe(3);   // 2×C100 saída própria + 1×C800 válida
    expect(r.docs).toHaveLength(2);   // 1 C100 + 1 C800 canceladas
  });
});
