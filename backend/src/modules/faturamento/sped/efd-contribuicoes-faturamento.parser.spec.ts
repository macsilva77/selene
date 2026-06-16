/**
 * Testes unitários de efd-contribuicoes-faturamento.parser.ts
 *
 * Funções puras — sem mocks. Buffer Latin-1.
 *
 * Registros testados:
 *   0000 — identificação (CNPJ, razão social, competência)
 *   A100 — NFS-e de serviços sujeitos ao ISS
 */

import {
  parseEfdContribuicoesFaturamento,
  FatoFaturamentoContrib,
} from './efd-contribuicoes-faturamento.parser';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buf(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'latin1');
}

/**
 * |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|...|
 *               [4]    [5]    [6]  [7]
 */
function linha0000(dtIni: string, nome: string, cnpj: string): string {
  return `|0000|6|0|${dtIni}|31012024|${nome}|${cnpj}|||SP||`;
}

/**
 * |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFE|DT_DOC|DT_EXE_SERV|
 *      VL_DOC|VL_DESC|VL_BC_PIS|ALIQ_PIS|VL_PIS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|COD_CTA|
 *  [2]        [3]     [4]       [5]      [6] [7] [8]        [9]        [10]   [11]
 *  [12]   [13]    [14]        [15]      [16]   [17]           [18]        [19]     [20]
 */
function linhaA100(
  indOper: string,
  codSit: string,
  vlDoc: string,
  vlPis = '0,00',
  vlCofins = '0,00',
): string {
  return (
    `|A100|${indOper}|0|PART001|${codSit}|001|000|000001|CHVNFSE|01012024|01012024|` +
    `${vlDoc}|0|${vlDoc}|3,00|${vlPis}|${vlDoc}|3,00|${vlCofins}|CTB001|`
  );
}

// ─── 0000 — identificação ─────────────────────────────────────────────────────

describe('parseEfdContribuicoesFaturamento — 0000', () => {
  const content = buf([
    linha0000('01032024', 'Consultoria Silva Ltda', '55666777000145'),
  ]);

  let resultado: FatoFaturamentoContrib;
  beforeAll(() => { resultado = parseEfdContribuicoesFaturamento(content); });

  it('extrai competência do DT_INI', () => {
    expect(resultado.competencia).toBe('2024-03');
  });

  it('extrai razão social', () => {
    expect(resultado.razaoSocial).toBe('Consultoria Silva Ltda');
  });

  it('normaliza CNPJ com 14 dígitos', () => {
    expect(resultado.cnpj).toBe('55666777000145');
  });
});

// ─── A100 — saída válida ──────────────────────────────────────────────────────

describe('parseEfdContribuicoesFaturamento — A100 saída válida', () => {
  const content = buf([
    linha0000('01042024', 'Serviços Alpha S.A.', '11222333000181'),
    linhaA100('1', '00', '15.000,00', '225,00', '690,00'),
  ]);

  let resultado: FatoFaturamentoContrib;
  beforeAll(() => { resultado = parseEfdContribuicoesFaturamento(content); });

  it('acumula vlServicos', () => {
    expect(resultado.vlServicos).toBeCloseTo(15000, 2);
  });

  it('acumula vlPis', () => {
    expect(resultado.vlPis).toBeCloseTo(225, 2);
  });

  it('acumula vlCofins', () => {
    expect(resultado.vlCofins).toBeCloseTo(690, 2);
  });

  it('conta 1 documento de serviço', () => {
    expect(resultado.qtdDocumentosServicos).toBe(1);
  });
});

// ─── A100 — entrada e cancelado ignorados ─────────────────────────────────────

describe('parseEfdContribuicoesFaturamento — A100 não-saída e cancelado', () => {
  it('ignora A100 de entrada (IND_OPER=0)', () => {
    const content = buf([
      linha0000('01012024', 'Empresa B', '22333444000172'),
      linhaA100('0', '00', '8.000,00', '120,00', '368,00'),
    ]);
    const r = parseEfdContribuicoesFaturamento(content);
    expect(r.vlServicos).toBe(0);
    expect(r.qtdDocumentosServicos).toBe(0);
  });

  it('ignora A100 cancelado (COD_SIT=02)', () => {
    const content = buf([
      linha0000('01012024', 'Empresa C', '33444555000163'),
      linhaA100('1', '02', '5.000,00', '75,00', '230,00'),
    ]);
    const r = parseEfdContribuicoesFaturamento(content);
    expect(r.vlServicos).toBe(0);
    expect(r.vlPis).toBe(0);
    expect(r.vlCofins).toBe(0);
  });

  it('ignora A100 extemporâneo cancelado (COD_SIT=03)', () => {
    const content = buf([
      linha0000('01012024', 'Empresa D', '44555666000154'),
      linhaA100('1', '03', '3.000,00', '45,00', '138,00'),
    ]);
    const r = parseEfdContribuicoesFaturamento(content);
    expect(r.vlServicos).toBe(0);
  });
});

// ─── Múltiplos documentos A100 ───────────────────────────────────────────────

describe('parseEfdContribuicoesFaturamento — múltiplos A100', () => {
  const content = buf([
    linha0000('01052024', 'Tech Services Ltda', '66777888000136'),
    linhaA100('1', '00', '10.000,00', '150,00', '460,00'),
    linhaA100('1', '00', '5.000,00', '75,00', '230,00'),
    linhaA100('1', '00', '3.000,00', '45,00', '138,00'),
  ]);

  let resultado: FatoFaturamentoContrib;
  beforeAll(() => { resultado = parseEfdContribuicoesFaturamento(content); });

  it('soma vlServicos de todos os A100', () => {
    expect(resultado.vlServicos).toBeCloseTo(18000, 2);
  });

  it('soma vlPis de todos os A100', () => {
    expect(resultado.vlPis).toBeCloseTo(270, 2);
  });

  it('soma vlCofins de todos os A100', () => {
    expect(resultado.vlCofins).toBeCloseTo(828, 2);
  });

  it('conta 3 documentos', () => {
    expect(resultado.qtdDocumentosServicos).toBe(3);
  });
});

// ─── Mix válido e inválido ────────────────────────────────────────────────────

describe('parseEfdContribuicoesFaturamento — mix de A100 válidos e inválidos', () => {
  const content = buf([
    linha0000('01062024', 'Mix Ltda', '77888999000127'),
    linhaA100('1', '00', '20.000,00', '300,00', '920,00'),  // válida
    linhaA100('0', '00', '5.000,00', '75,00', '230,00'),    // entrada — ignorada
    linhaA100('1', '02', '8.000,00', '120,00', '368,00'),   // cancelada — ignorada
    linhaA100('1', '00', '12.000,00', '180,00', '552,00'),  // válida
  ]);

  let resultado: FatoFaturamentoContrib;
  beforeAll(() => { resultado = parseEfdContribuicoesFaturamento(content); });

  it('acumula apenas A100 de saída válidos', () => {
    expect(resultado.vlServicos).toBeCloseTo(32000, 2);
  });

  it('conta apenas documentos válidos', () => {
    expect(resultado.qtdDocumentosServicos).toBe(2);
  });

  it('PIS apenas das saídas válidas', () => {
    expect(resultado.vlPis).toBeCloseTo(480, 2);
  });

  it('COFINS apenas das saídas válidas', () => {
    expect(resultado.vlCofins).toBeCloseTo(1472, 2);
  });
});

// ─── Arquivo sem A100 ────────────────────────────────────────────────────────

describe('parseEfdContribuicoesFaturamento — arquivo sem serviços', () => {
  it('retorna zeros quando não há A100', () => {
    const content = buf([
      linha0000('01072024', 'Sem Serviços Ltda', '88999000000118'),
    ]);
    const r = parseEfdContribuicoesFaturamento(content);
    expect(r.vlServicos).toBe(0);
    expect(r.vlPis).toBe(0);
    expect(r.vlCofins).toBe(0);
    expect(r.qtdDocumentosServicos).toBe(0);
  });
});

// ─── Competência correta ──────────────────────────────────────────────────────

describe('parseEfdContribuicoesFaturamento — competência', () => {
  it.each([
    ['01012024', '2024-01'],
    ['01122023', '2023-12'],
    ['01062025', '2025-06'],
  ])('DT_INI %s → competência %s', (dtIni, esperado) => {
    const content = buf([linha0000(dtIni, 'Empresa X', '12345678000195')]);
    const r = parseEfdContribuicoesFaturamento(content);
    expect(r.competencia).toBe(esperado);
  });
});
