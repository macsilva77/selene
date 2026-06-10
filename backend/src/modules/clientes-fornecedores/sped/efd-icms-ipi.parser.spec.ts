/**
 * Testes unitários de efd-icms-ipi.parser.ts
 *
 * As funções são puras (sem efeitos colaterais), portanto nenhum mock é necessário.
 * O parser aceita um Buffer com conteúdo Latin-1.
 *
 * Registros testados:
 *   0150 — cadastro do participante
 *   C100 — documentos fiscais de mercadorias
 *   D100 — documentos de transporte (CT-e)
 */

import { parseEfdIcmsIpi, parseBr, FatoParticipante } from './efd-icms-ipi.parser';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Monta um Buffer Latin-1 a partir de linhas pipe-delimitadas. */
function buf(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'latin1');
}

/** Monta uma linha 0150 com campos preenchidos. */
function linha0150(codPart: string, nome: string, cnpj: string): string {
  // |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|...|
  return `|0150|${codPart}|${nome}|1058|${cnpj}|||||||`;
}

/** Monta uma linha C100.
 *  Índices usados: [2]=IND_OPER, [4]=COD_PART, [6]=COD_SIT, [12]=VL_DOC
 *  Layout completo: |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|...|
 */
function linhaC100(indOper: string, codPart: string, codSit: string, vlDoc: string): string {
  // pos:  0     1     2        3        4        5       6       7    8        9       10       11      12
  return `|C100|${indOper}|1|${codPart}|55|${codSit}|001|000001|CHV|01012024|01012024|${vlDoc}|0|0|0|0|0|0|0|`;
}

/** Monta uma linha D100.
 *  Índices usados: [2]=IND_OPER, [4]=COD_PART, [6]=COD_SIT, [15]=VL_DOC
 *  Layout: |D100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|SUB|NUM_DOC|CHV_CTE|DT_DOC|DT_A_P|TP_CT-e|CHAVE_CTE_REF|VL_DOC|...|
 *  pos:      0    1        2        3        4        5       6    7   8       9       10      11      12      13            14     15
 */
function linhaD100(indOper: string, codPart: string, codSit: string, vlDoc: string): string {
  return `|D100|${indOper}|1|${codPart}|57|${codSit}|001|000|000001|CHVCTE|01012024|01012024|0||${vlDoc}|0|`;
}

// ─── parseBr ─────────────────────────────────────────────────────────────────
//
// Comportamento real de parseBr: substitui APENAS a primeira vírgula por ponto
// (String.replace com literal, não regex global). Portanto:
//   '250,75'   → '250.75'   → 250.75  ✓
//   '100,50'   → '100.50'   → 100.5   ✓
//   '1.500,00' → '1.500.00' → 1.5     (parseFloat para na segunda ocorrência de ponto)
// Os valores nos testes de documentos usam apenas vírgula (sem ponto de milhar).

describe('parseBr', () => {
  it('converte valor com vírgula como separador decimal', () => {
    expect(parseBr('250,75')).toBeCloseTo(250.75, 4);
  });

  it('converte valor inteiro com vírgula e zeros', () => {
    expect(parseBr('800,00')).toBeCloseTo(800, 2);
  });

  it('retorna 0 para string vazia', () => {
    expect(parseBr('')).toBe(0);
  });

  it('retorna 0 para valor não numérico (NaN)', () => {
    expect(parseBr('abc')).toBe(0);
  });

  it('aceita valor já com ponto como separador decimal', () => {
    expect(parseBr('100.50')).toBeCloseTo(100.5, 4);
  });
});

// ─── C100 — cliente ───────────────────────────────────────────────────────────

describe('parseEfdIcmsIpi — C100 cliente (IND_OPER=1)', () => {
  const content = buf([
    linha0150('CLI001', 'Empresa Alpha Ltda', '12345678000195'),
    linhaC100('1', 'CLI001', '00', '5000,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdIcmsIpi(content); });

  it('retorna exatamente 1 participante', () => {
    expect(resultado).toHaveLength(1);
  });

  it('tipoParticipante é CLIENTE', () => {
    expect(resultado[0].tipoParticipante).toBe('CLIENTE');
  });

  it('valorTotal correto', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(5000, 2);
  });

  it('quantidadeDocumentos = 1', () => {
    expect(resultado[0].quantidadeDocumentos).toBe(1);
  });

  it('razaoSocial preenchida', () => {
    expect(resultado[0].razaoSocial).toBe('Empresa Alpha Ltda');
  });

  it('cnpj normalizado com 14 dígitos', () => {
    expect(resultado[0].cnpj).toBe('12345678000195');
  });

  it('cnpjRaiz = 8 primeiros dígitos do cnpj', () => {
    expect(resultado[0].cnpjRaiz).toBe('12345678');
  });
});

// ─── C100 — fornecedor ────────────────────────────────────────────────────────

describe('parseEfdIcmsIpi — C100 fornecedor (IND_OPER=0)', () => {
  const content = buf([
    linha0150('FORN001', 'Fornecedor Beta S.A.', '98765432000111'),
    linhaC100('0', 'FORN001', '00', '3200,50'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdIcmsIpi(content); });

  it('retorna 1 participante', () => {
    expect(resultado).toHaveLength(1);
  });

  it('tipoParticipante é FORNECEDOR', () => {
    expect(resultado[0].tipoParticipante).toBe('FORNECEDOR');
  });

  it('valorTotal correto', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(3200.5, 2);
  });
});

// ─── C100 — COD_SIT ≠ '00' deve ser ignorado ─────────────────────────────────

describe('parseEfdIcmsIpi — C100 com COD_SIT≠00 ignorado', () => {
  it('não inclui documento cancelado (COD_SIT=02)', () => {
    const content = buf([
      linha0150('CLI002', 'Empresa Gama', '11222333000181'),
      linhaC100('1', 'CLI002', '02', '9000,00'),
    ]);
    const resultado = parseEfdIcmsIpi(content);
    expect(resultado).toHaveLength(0);
  });

  it('não inclui documento denegado (COD_SIT=07)', () => {
    const content = buf([
      linha0150('CLI003', 'Empresa Delta', '44555666000177'),
      linhaC100('1', 'CLI003', '07', '1000,00'),
    ]);
    const resultado = parseEfdIcmsIpi(content);
    expect(resultado).toHaveLength(0);
  });
});

// ─── D100 — transporte como cliente ──────────────────────────────────────────

describe('parseEfdIcmsIpi — D100 transporte', () => {
  const content = buf([
    linha0150('TRANS001', 'Transportadora Ômega', '55666777000199'),
    linhaD100('1', 'TRANS001', '00', '800,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdIcmsIpi(content); });

  it('retorna 1 participante do D100', () => {
    expect(resultado).toHaveLength(1);
  });

  it('tipoParticipante é CLIENTE (IND_OPER=1)', () => {
    expect(resultado[0].tipoParticipante).toBe('CLIENTE');
  });

  it('valorTotal correto', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(800, 2);
  });

  it('razaoSocial preenchida via 0150', () => {
    expect(resultado[0].razaoSocial).toBe('Transportadora Ômega');
  });
});

// ─── Múltiplos documentos do mesmo participante ───────────────────────────────

describe('parseEfdIcmsIpi — múltiplos documentos do mesmo participante', () => {
  const content = buf([
    linha0150('CLI010', 'Empresa Multi', '77888999000155'),
    linhaC100('1', 'CLI010', '00', '1000,00'),
    linhaC100('1', 'CLI010', '00', '2500,00'),
    linhaC100('1', 'CLI010', '00', '500,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdIcmsIpi(content); });

  it('consolida em 1 participante', () => {
    expect(resultado).toHaveLength(1);
  });

  it('soma os valores', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(4000, 2);
  });

  it('qtd documentos = 3', () => {
    expect(resultado[0].quantidadeDocumentos).toBe(3);
  });
});

// ─── Participante sem 0150 deve ser ignorado ──────────────────────────────────

describe('parseEfdIcmsIpi — participante sem 0150', () => {
  it('não inclui participante sem cadastro 0150', () => {
    // COD_PART 'DESCONHECIDO' não tem 0150 correspondente
    const content = buf([
      linhaC100('1', 'DESCONHECIDO', '00', '9999,00'),
    ]);
    const resultado = parseEfdIcmsIpi(content);
    expect(resultado).toHaveLength(0);
  });

  it('inclui apenas participantes com 0150 quando há mistura', () => {
    const content = buf([
      linha0150('CLI_OK', 'Empresa OK', '12312312300001'),
      linhaC100('1', 'CLI_OK', '00', '1000,00'),
      linhaC100('0', 'SEM_CADASTRO', '00', '5000,00'), // sem 0150
    ]);
    const resultado = parseEfdIcmsIpi(content);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].codPart).toBe('CLI_OK');
  });
});

// ─── Mix C100 + D100 para mesmo participante ─────────────────────────────────

describe('parseEfdIcmsIpi — participante em C100 e D100 como CLIENTE', () => {
  const content = buf([
    linha0150('PART_MIX', 'Empresa Mix', '33344455500001'),
    linhaC100('1', 'PART_MIX', '00', '2000,00'),
    linhaD100('1', 'PART_MIX', '00', '1000,00'),
  ]);

  // C100 e D100 do mesmo participante geram chaves diferentes internamente,
  // mas são consolidadas na mesma entrada pois compartilham (codPart + tipo)
  it('consolida C100 + D100 do mesmo participante CLIENTE', () => {
    const resultado = parseEfdIcmsIpi(content);
    const cliente = resultado.find(r => r.tipoParticipante === 'CLIENTE');
    expect(cliente).toBeDefined();
    expect(cliente!.valorTotal).toBeCloseTo(3000, 2);
    expect(cliente!.quantidadeDocumentos).toBe(2);
  });
});
