/**
 * Testes unitários de efd-contribuicoes.parser.ts
 *
 * As funções são puras (sem efeitos colaterais), portanto nenhum mock é necessário.
 * O parser aceita um Buffer com conteúdo Latin-1.
 *
 * Registros testados:
 *   0150 — cadastro do participante (para lookup A100)
 *   A100 — documentos de serviços ISS (Bloco A)
 *   F100 — demais documentos (Bloco F, participante via COD_PART → 0150)
 */

import { parseEfdContribuicoes } from './efd-contribuicoes.parser';
import { FatoParticipante } from './efd-icms-ipi.parser';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Monta um Buffer Latin-1 a partir de linhas pipe-delimitadas. */
function buf(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'latin1');
}

/** Monta uma linha 0150.
 *  |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|...|
 *  IDX: [2]=COD_PART [3]=NOME [5]=CNPJ
 */
function linha0150(codPart: string, nome: string, cnpj: string): string {
  return `|0150|${codPart}|${nome}|1058|${cnpj}|||||||`;
}

/** Monta uma linha A100.
 *  |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFE|DT_DOC|DT_EXE_SERV|VL_DOC|...|
 *  IDX: [2]=IND_OPER [4]=COD_PART [5]=COD_SIT [12]=VL_DOC
 */
function linhaA100(indOper: string, codPart: string, codSit: string, vlDoc: string): string {
  // pos: 0    1     2        3  4        5       6    7    8        9    10       11       12
  return `|A100|${indOper}|1|${codPart}|${codSit}|001|000|000001|CHV|01012024|01012024|${vlDoc}|0|`;
}

/** Monta uma linha F100 (layout real).
 *  |F100|IND_OPER|COD_PART|COD_ITEM|DT_OPER|VL_OPER|CST_PIS|...|
 *  IDX: [2]=IND_OPER [3]=COD_PART [6]=VL_OPER
 *  O participante é resolvido por COD_PART → 0150 (não há CNPJ direto no F100).
 */
function linhaF100(indOper: string, codPart: string, vlOper: string): string {
  // pos: 0    1     2        3         4      5          6
  return `|F100|${indOper}|${codPart}|ITEM01|01012024|${vlOper}|02|`;
}

// ─── A100 — cliente ───────────────────────────────────────────────────────────

describe('parseEfdContribuicoes — A100 cliente (IND_OPER=1, COD_SIT=00)', () => {
  const content = buf([
    linha0150('CLI001', 'Prestadora Alpha Ltda', '12345678000195'),
    linhaA100('1', 'CLI001', '00', '4000,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdContribuicoes(content); });

  it('retorna exatamente 1 participante', () => {
    expect(resultado).toHaveLength(1);
  });

  it('tipoParticipante é CLIENTE', () => {
    expect(resultado[0].tipoParticipante).toBe('CLIENTE');
  });

  it('valorTotal correto', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(4000, 2);
  });

  it('quantidadeDocumentos = 1', () => {
    expect(resultado[0].quantidadeDocumentos).toBe(1);
  });

  it('razaoSocial preenchida via 0150', () => {
    expect(resultado[0].razaoSocial).toBe('Prestadora Alpha Ltda');
  });

  it('cnpj normalizado com 14 dígitos', () => {
    expect(resultado[0].cnpj).toBe('12345678000195');
  });
});

// ─── A100 — COD_SIT ≠ '00' deve ser ignorado ─────────────────────────────────

describe('parseEfdContribuicoes — A100 com COD_SIT≠00 ignorado', () => {
  it('não inclui documento com COD_SIT=02 (cancelado)', () => {
    const content = buf([
      linha0150('CLI002', 'Empresa Beta', '99888777000166'),
      linhaA100('1', 'CLI002', '02', '7000,00'),
    ]);
    const resultado = parseEfdContribuicoes(content);
    expect(resultado).toHaveLength(0);
  });

  it('inclui apenas documentos válidos quando há mistura de COD_SIT', () => {
    const content = buf([
      linha0150('CLI003', 'Empresa Gama', '33322211100001'),
      linhaA100('1', 'CLI003', '00', '1000,00'),
      linhaA100('1', 'CLI003', '02', '9000,00'), // deve ser ignorado
    ]);
    const resultado = parseEfdContribuicoes(content);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].valorTotal).toBeCloseTo(1000, 2);
  });
});

// ─── F100 — participante via COD_PART → 0150 ─────────────────────────────────

describe('parseEfdContribuicoes — F100 via COD_PART → 0150', () => {
  const content = buf([
    linha0150('PART01', 'Cliente F Ltda', '12345678000195'),
    linhaF100('1', 'PART01', '3500,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdContribuicoes(content); });

  it('retorna 1 participante resolvido pelo 0150', () => {
    expect(resultado).toHaveLength(1);
  });

  it('tipoParticipante é CLIENTE (IND_OPER=1)', () => {
    expect(resultado[0].tipoParticipante).toBe('CLIENTE');
  });

  it('valorTotal é o VL_OPER (campo 6), não a data', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(3500, 2);
  });

  it('cnpj e razaoSocial vêm do 0150', () => {
    expect(resultado[0].cnpj).toBe('12345678000195');
    expect(resultado[0].razaoSocial).toBe('Cliente F Ltda');
  });
});

// ─── F100 sem COD_PART deve ser ignorado ─────────────────────────────────────

describe('parseEfdContribuicoes — F100 sem COD_PART ignorado', () => {
  it('não inclui F100 com COD_PART vazio', () => {
    const content = buf([linhaF100('0', '', '1000,00')]);
    expect(parseEfdContribuicoes(content)).toHaveLength(0);
  });

  it('não inclui F100 com COD_PART sem 0150 correspondente', () => {
    const content = buf([
      linha0150('OUTRO', 'Outra Empresa', '99999999000199'),
      linhaF100('0', 'NAOEXISTE', '800,00'),
    ]);
    expect(parseEfdContribuicoes(content)).toHaveLength(0);
  });
});

// ─── Merge: mesmo participante em A100 e F100 ────────────────────────────────

describe('parseEfdContribuicoes — merge de A100 e F100 do mesmo participante', () => {
  // A100 e F100 usam COD_PART → 0150. São acumulados em chaves distintas
  // (A|codPart|tipo vs F|codPart|tipo), aparecendo como duas entradas (o merge
  // por CNPJ acontece depois, no parquet/DuckDB). Mesmo cnpj/razão em ambas.
  const cnpj = '55566677700001';
  const content = buf([
    linha0150('PART_AB', 'Empresa Mista SA', cnpj),
    linhaA100('1', 'PART_AB', '00', '2000,00'),
    linhaF100('1', 'PART_AB', '3000,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdContribuicoes(content); });

  it('retorna 2 entradas (A100 + F100, chaves distintas)', () => {
    expect(resultado).toHaveLength(2);
  });

  it('soma total dos dois blocos é 5.000', () => {
    const totalClientes = resultado
      .filter(r => r.tipoParticipante === 'CLIENTE')
      .reduce((acc, r) => acc + r.valorTotal, 0);
    expect(totalClientes).toBeCloseTo(5000, 2);
  });

  it('ambas as entradas têm cnpj e razaoSocial do 0150', () => {
    expect(resultado).toHaveLength(2);
    for (const r of resultado) {
      expect(r.cnpj).toBe(cnpj);
      expect(r.razaoSocial).toBe('Empresa Mista SA');
    }
  });
});

// ─── A100 fornecedor ──────────────────────────────────────────────────────────

describe('parseEfdContribuicoes — A100 fornecedor (IND_OPER=0)', () => {
  const content = buf([
    linha0150('FORN001', 'Fornecedor Sigma Ltda', '77766655500001'),
    linhaA100('0', 'FORN001', '00', '1200,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdContribuicoes(content); });

  it('tipoParticipante é FORNECEDOR', () => {
    expect(resultado[0].tipoParticipante).toBe('FORNECEDOR');
  });

  it('valorTotal correto', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(1200, 2);
  });
});

// ─── F100 fornecedor ──────────────────────────────────────────────────────────

describe('parseEfdContribuicoes — F100 fornecedor (IND_OPER=0)', () => {
  const content = buf([
    linha0150('FORNF', 'Fornecedor F Ltda', '44433322200001'),
    linhaF100('0', 'FORNF', '900,00'),
  ]);

  let resultado: FatoParticipante[];
  beforeAll(() => { resultado = parseEfdContribuicoes(content); });

  it('tipoParticipante é FORNECEDOR', () => {
    expect(resultado[0].tipoParticipante).toBe('FORNECEDOR');
  });

  it('valorTotal correto', () => {
    expect(resultado[0].valorTotal).toBeCloseTo(900, 2);
  });
});
