/**
 * Testes unitários de efd-icms-ipi-faturamento.parser.ts
 *
 * Funções puras — sem mocks. O parser aceita um Buffer Latin-1.
 *
 * Registros testados:
 *   0000 — identificação (CNPJ, razão social, competência)
 *   C100 — documentos fiscais de saída
 *   C190 — analítico por CFOP (filho do C100)
 */

import {
  parseEfdIcmsIpiFaturamento,
  extrairCompetencia,
  FatoFaturamento,
} from './efd-icms-ipi-faturamento.parser';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buf(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'latin1');
}

/**
 * |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|...|
 *       [2]     [3]     [4]    [5]    [6]  [7]
 */
function linha0000(dtIni: string, nome: string, cnpj: string): string {
  return `|0000|9|0|${dtIni}|31012024|${nome}|${cnpj}|||SP||`;
}

/**
 * |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|
 *      VL_DOC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|
 *      VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|
 * idx: [2]   [3]     [4]      [5]    [6]    [7]  [8]    [9]    [10]   [11]
 *      [12]  [13]    [14]   [15]   [16]  [17]  [18]     [19]      [20]
 *      [21]          [22]   [23]
 */
function linhaC100(
  indOper: string,
  codSit: string,
  vlDoc: string,
  vlIpi = '0,00',
): string {
  // 10 zeros entre vlDoc e vlIpi preenchem as posições 13–22
  return `|C100|${indOper}|0|PART001|55|${codSit}|001|000001|CHVNFE|01012024|01012024|${vlDoc}|0|0|0|0|0|0|0|0|0|0|${vlIpi}|`;
}

/**
 * |C190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|
 *       [2]     [3]   [4]       [5]    [6]         [7]
 */
function linhaC190(cfop: string, vlOpr: string, vlIcms: string): string {
  return `|C190|000|${cfop}|12,00|${vlOpr}|${vlOpr}|${vlIcms}|0|0|0|`;
}

// ─── extrairCompetencia ───────────────────────────────────────────────────────

describe('extrairCompetencia', () => {
  it('converte DDMMAAAA para AAAA-MM', () => {
    expect(extrairCompetencia('01012024')).toBe('2024-01');
  });

  it('preserva mês com zero à esquerda', () => {
    expect(extrairCompetencia('01032025')).toBe('2025-03');
  });

  it('retorna string vazia para data com menos de 8 caracteres', () => {
    expect(extrairCompetencia('0101')).toBe('');
  });

  it('retorna string vazia quando ano < 2000', () => {
    expect(extrairCompetencia('01011999')).toBe('');
  });
});

// ─── 0000 — identificação ─────────────────────────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — 0000', () => {
  const content = buf([
    linha0000('01012024', 'Empresa Teste Ltda', '12345678000195'),
  ]);

  let resultado: FatoFaturamento;
  beforeAll(() => { resultado = parseEfdIcmsIpiFaturamento(content); });

  it('extrai competência do DT_INI', () => {
    expect(resultado.competencia).toBe('2024-01');
  });

  it('extrai razão social', () => {
    expect(resultado.razaoSocial).toBe('Empresa Teste Ltda');
  });

  it('normaliza CNPJ com 14 dígitos', () => {
    expect(resultado.cnpj).toBe('12345678000195');
  });
});

// ─── C100 — saída válida ──────────────────────────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — C100 saída válida', () => {
  const content = buf([
    linha0000('01012024', 'Empresa A', '11222333000181'),
    linhaC100('1', '00', '10.000,00', '500,00'),
  ]);

  let resultado: FatoFaturamento;
  beforeAll(() => { resultado = parseEfdIcmsIpiFaturamento(content); });

  it('acumula vlFaturamentoBruto', () => {
    expect(resultado.vlFaturamentoBruto).toBeCloseTo(10000, 2);
  });

  it('acumula vlIpi', () => {
    expect(resultado.vlIpi).toBeCloseTo(500, 2);
  });

  it('conta 1 documento', () => {
    expect(resultado.qtdDocumentos).toBe(1);
  });
});

// ─── C100 — entradas e cancelados ignorados ───────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — C100 não-saída e cancelado', () => {
  it('ignora C100 de entrada (IND_OPER=0)', () => {
    const content = buf([
      linha0000('01012024', 'Empresa B', '22333444000172'),
      linhaC100('0', '00', '5.000,00'),
    ]);
    const r = parseEfdIcmsIpiFaturamento(content);
    expect(r.vlFaturamentoBruto).toBe(0);
    expect(r.qtdDocumentos).toBe(0);
  });

  it('ignora C100 cancelado (COD_SIT=02)', () => {
    const content = buf([
      linha0000('01012024', 'Empresa C', '33444555000163'),
      linhaC100('1', '02', '9.000,00'),
    ]);
    const r = parseEfdIcmsIpiFaturamento(content);
    expect(r.vlFaturamentoBruto).toBe(0);
    expect(r.qtdDocumentos).toBe(0);
  });

  it('ignora C100 denegado (COD_SIT=07)', () => {
    const content = buf([
      linha0000('01012024', 'Empresa D', '44555666000154'),
      linhaC100('1', '07', '7.000,00'),
    ]);
    const r = parseEfdIcmsIpiFaturamento(content);
    expect(r.vlFaturamentoBruto).toBe(0);
  });
});

// ─── C190 — breakdown por CFOP ───────────────────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — C190 após C100 válido', () => {
  const content = buf([
    linha0000('01012024', 'Empresa E', '55666777000145'),
    linhaC100('1', '00', '8.000,00'),
    linhaC190('5102', '8.000,00', '960,00'),
  ]);

  let resultado: FatoFaturamento;
  beforeAll(() => { resultado = parseEfdIcmsIpiFaturamento(content); });

  it('acumula vlIcms do C190', () => {
    expect(resultado.vlIcms).toBeCloseTo(960, 2);
  });

  it('registra CFOP no breakdown', () => {
    expect(resultado.cfops).toHaveLength(1);
    expect(resultado.cfops[0].cfop).toBe('5102');
  });

  it('acumula vlOpr do CFOP', () => {
    expect(resultado.cfops[0].vlOpr).toBeCloseTo(8000, 2);
  });

  it('conta 1 ocorrência do CFOP', () => {
    expect(resultado.cfops[0].qtd).toBe(1);
  });
});

describe('parseEfdIcmsIpiFaturamento — C190 após C100 inválido', () => {
  it('não acumula C190 após C100 de entrada', () => {
    const content = buf([
      linha0000('01012024', 'Empresa F', '66777888000136'),
      linhaC100('0', '00', '5.000,00'),
      linhaC190('1102', '5.000,00', '600,00'),
    ]);
    const r = parseEfdIcmsIpiFaturamento(content);
    expect(r.vlIcms).toBe(0);
    expect(r.cfops).toHaveLength(0);
  });

  it('não acumula C190 após C100 cancelado', () => {
    const content = buf([
      linha0000('01012024', 'Empresa G', '77888999000127'),
      linhaC100('1', '02', '5.000,00'),
      linhaC190('5102', '5.000,00', '600,00'),
    ]);
    const r = parseEfdIcmsIpiFaturamento(content);
    expect(r.vlIcms).toBe(0);
    expect(r.cfops).toHaveLength(0);
  });
});

// ─── Múltiplos documentos e CFOPs ────────────────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — múltiplos C100 e C190', () => {
  // Dois documentos de saída, mesmo CFOP → deve consolidar
  const content = buf([
    linha0000('01022024', 'Empresa H', '88999000000118'),
    linhaC100('1', '00', '3.000,00'),
    linhaC190('5102', '3.000,00', '360,00'),
    linhaC100('1', '00', '2.000,00'),
    linhaC190('5102', '2.000,00', '240,00'),
  ]);

  let resultado: FatoFaturamento;
  beforeAll(() => { resultado = parseEfdIcmsIpiFaturamento(content); });

  it('soma os vlFaturamentoBruto dos dois C100', () => {
    expect(resultado.vlFaturamentoBruto).toBeCloseTo(5000, 2);
  });

  it('conta 2 documentos', () => {
    expect(resultado.qtdDocumentos).toBe(2);
  });

  it('consolida vlOpr do mesmo CFOP', () => {
    expect(resultado.cfops).toHaveLength(1);
    expect(resultado.cfops[0].vlOpr).toBeCloseTo(5000, 2);
  });

  it('conta 2 ocorrências do mesmo CFOP', () => {
    expect(resultado.cfops[0].qtd).toBe(2);
  });

  it('soma vlIcms de ambos os C190', () => {
    expect(resultado.vlIcms).toBeCloseTo(600, 2);
  });

  it('competência reflete DT_INI do 0000', () => {
    expect(resultado.competencia).toBe('2024-02');
  });
});

// ─── Múltiplos CFOPs por C100 ────────────────────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — múltiplos C190 por C100', () => {
  // Um C100 com dois C190 de CFOPs distintos
  const content = buf([
    linha0000('01032024', 'Empresa I', '99000111000109'),
    linhaC100('1', '00', '10.000,00'),
    linhaC190('5102', '7.000,00', '840,00'),
    linhaC190('5949', '3.000,00', '0,00'),
  ]);

  let resultado: FatoFaturamento;
  beforeAll(() => { resultado = parseEfdIcmsIpiFaturamento(content); });

  it('gera 2 entradas no breakdown de CFOPs', () => {
    expect(resultado.cfops).toHaveLength(2);
  });

  it('CFOPs ordenados por código', () => {
    expect(resultado.cfops[0].cfop).toBe('5102');
    expect(resultado.cfops[1].cfop).toBe('5949');
  });

  it('vlIcms acumula apenas o C190 5102', () => {
    expect(resultado.vlIcms).toBeCloseTo(840, 2);
  });
});

// ─── CFOPs fora de ordem retornam ordenados ───────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — ordenação de CFOPs', () => {
  const content = buf([
    linha0000('01042024', 'Empresa J', '00111222000190'),
    linhaC100('1', '00', '9.000,00'),
    linhaC190('6102', '4.000,00', '0,00'),
    linhaC190('5102', '5.000,00', '600,00'),
  ]);

  it('retorna CFOPs em ordem ascendente', () => {
    const r = parseEfdIcmsIpiFaturamento(content);
    const codigos = r.cfops.map(c => c.cfop);
    expect(codigos).toEqual([...codigos].sort());
  });
});

// ─── Arquivo sem C100 ────────────────────────────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — arquivo sem documentos', () => {
  const content = buf([
    linha0000('01012024', 'Empresa Vazia', '12121212000100'),
  ]);

  it('retorna zeros e cfops vazio', () => {
    const r = parseEfdIcmsIpiFaturamento(content);
    expect(r.vlFaturamentoBruto).toBe(0);
    expect(r.vlIcms).toBe(0);
    expect(r.vlIpi).toBe(0);
    expect(r.qtdDocumentos).toBe(0);
    expect(r.cfops).toHaveLength(0);
  });
});

// ─── Mix saída válida e inválida ─────────────────────────────────────────────

describe('parseEfdIcmsIpiFaturamento — mix de documentos válidos e inválidos', () => {
  const content = buf([
    linha0000('01012024', 'Empresa Mix', '33333333000100'),
    linhaC100('1', '00', '5.000,00'),  // saída válida
    linhaC190('5102', '5.000,00', '600,00'),
    linhaC100('0', '00', '2.000,00'),  // entrada — ignorada
    linhaC190('1102', '2.000,00', '240,00'), // filho de C100 inválido — ignorado
    linhaC100('1', '02', '3.000,00'),  // cancelado — ignorado
    linhaC190('5102', '3.000,00', '360,00'), // filho de cancelado — ignorado
    linhaC100('1', '00', '1.000,00'),  // saída válida
    linhaC190('6102', '1.000,00', '120,00'),
  ]);

  let resultado: FatoFaturamento;
  beforeAll(() => { resultado = parseEfdIcmsIpiFaturamento(content); });

  it('acumula apenas saídas válidas no vlFaturamentoBruto', () => {
    expect(resultado.vlFaturamentoBruto).toBeCloseTo(6000, 2);
  });

  it('conta apenas documentos válidos', () => {
    expect(resultado.qtdDocumentos).toBe(2);
  });

  it('vlIcms apenas dos C190 de saídas válidas', () => {
    expect(resultado.vlIcms).toBeCloseTo(720, 2);
  });

  it('CFOPs apenas das saídas válidas', () => {
    const codigos = resultado.cfops.map(c => c.cfop);
    expect(codigos).toContain('5102');
    expect(codigos).toContain('6102');
    expect(codigos).not.toContain('1102');
  });
});
