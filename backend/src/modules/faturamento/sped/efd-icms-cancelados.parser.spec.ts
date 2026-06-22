import { Readable } from 'node:stream';
import { parseEfdIcmsCancelados } from './efd-icms-cancelados.parser';

function stream(lines: string[]): Readable {
  return Readable.from([Buffer.from(lines.join('\n'), 'latin1')]);
}

const l0000 = (dtIni: string) => `|0000|9|0|${dtIni}|31012024|Empresa X|12345678000195|||SP||`;

// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...
const c100 = (codSit: string, vlDoc: string, indOper = '1', num = '000001', indEmit = '0') =>
  `|C100|${indOper}|${indEmit}|PART1|55|${codSit}|1|${num}|CHV${num}|15012024|15012024|${vlDoc}|0|0|0|0|0|0|0|0|0|0|0|0|`;

// |C800|COD_MOD|COD_SIT|NUM_CFE|DT_DOC|VL_CFE|VL_PIS|VL_COFINS|CNPJ_CPF|NR_SAT|CHV_CFE|
const c800 = (codSit: string, vlCfe: string, num = '000010') =>
  `|C800|65|${codSit}|${num}|15012024|${vlCfe}|0|0|||CHVSAT${num}|`;

describe('parseEfdIcmsCancelados', () => {
  it('coleta apenas C100 cancelados (02/03), ignorando válidos', async () => {
    const docs = await parseEfdIcmsCancelados(stream([
      l0000('01012024'),
      c100('00', '1.000,00'),   // válido — ignorado
      c100('02', '5.000,00'),   // cancelado
      c100('03', '7.000,00'),   // cancelado extemporâneo
      c100('07', '9.000,00'),   // denegado — não é cancelamento
    ]));
    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.codSit).sort()).toEqual(['02', '03']);
    expect(docs.find(d => d.codSit === '03')?.extemporaneo).toBe(true);
    expect(docs.find(d => d.codSit === '02')?.extemporaneo).toBe(false);
  });

  it('exclui C100 cancelado de TERCEIROS (IND_EMIT=1) — só emissão própria', async () => {
    const docs = await parseEfdIcmsCancelados(stream([
      l0000('01012024'),
      c100('02', '1.000,00', '1', '000001', '0'),  // própria — conta
      c100('02', '2.000,00', '0', '000002', '1'),  // terceiros — ignorado
      c100('03', '3.000,00', '1', '000003', '1'),  // terceiros extemp — ignorado
    ]));
    expect(docs).toHaveLength(1);
    expect(docs[0].numDoc).toBe('000001');
  });

  it('captura competência, valor, indOper e chave do C100', async () => {
    const [d] = await parseEfdIcmsCancelados(stream([
      l0000('01032025'),
      c100('02', '12.345,67', '1', '000099'),
    ]));
    expect(d.competencia).toBe('2025-03');
    expect(d.vlDoc).toBeCloseTo(12345.67, 2);
    expect(d.indOper).toBe('1');
    expect(d.tipo).toBe('NFe');
    expect(d.numDoc).toBe('000099');
    expect(d.chave).toBe('CHV000099');
  });

  it('distingue entrada (indOper=0) de saída (1)', async () => {
    const docs = await parseEfdIcmsCancelados(stream([
      l0000('01012024'),
      c100('02', '1.000,00', '0'),  // entrada cancelada
      c100('02', '2.000,00', '1'),  // saída cancelada
    ]));
    expect(docs.find(d => d.indOper === '0')?.vlDoc).toBeCloseTo(1000, 2);
    expect(docs.find(d => d.indOper === '1')?.vlDoc).toBeCloseTo(2000, 2);
  });

  it('coleta C800 (SAT) cancelado como saída, com VL_CFE e chave', async () => {
    const docs = await parseEfdIcmsCancelados(stream([
      l0000('01012024'),
      c800('00', '50,00'),     // regular — ignorado
      c800('02', '80,00'),     // cancelado
    ]));
    expect(docs).toHaveLength(1);
    const d = docs[0];
    expect(d.tipo).toBe('SAT');
    expect(d.indOper).toBe('1');
    expect(d.vlDoc).toBeCloseTo(80, 2);
    expect(d.chave).toBe('CHVSAT000010');
  });

  it('arquivo sem cancelados retorna vazio', async () => {
    const docs = await parseEfdIcmsCancelados(stream([
      l0000('01012024'),
      c100('00', '1.000,00'),
      c800('00', '50,00'),
    ]));
    expect(docs).toHaveLength(0);
  });
});
