/**
 * Parser de EFD Contribuições — fonte de Blocos A e F.
 *
 * Registros utilizados:
 *   0150 — Cadastro do Participante (para A100)
 *   A100 — Documentos de serviços sujeitos ao ISS (Bloco A)
 *   F100 — Demais documentos e operações (Bloco F)
 *
 * Regra: COD_SIT = "00" em A100 → documento válido.
 *        F100 não possui COD_SIT — todos incluídos (empresa já filtra na entrega).
 *        IND_OPER = 0 → FORNECEDOR | IND_OPER = 1 → CLIENTE
 *
 * Layout (pipe-delimitado, latin1):
 *   |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|...|
 *   |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFE|DT_DOC|DT_EXE_SERV|VL_DOC|...|
 *   |F100|IND_OPER|CNPJ|DT_EMIS|VL_DOC|...|
 */

import { FatoParticipante, parseBr, iterLines } from './efd-icms-ipi.parser';

// Índices após split('|')
const IDX_0150 = { COD_PART: 2, NOME: 3, CNPJ: 5 } as const;

// A100: |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFE|DT_DOC|DT_EXE_SERV|VL_DOC|...|
const IDX_A100 = { IND_OPER: 2, COD_PART: 4, COD_SIT: 5, VL_DOC: 12 } as const;

// F100: |F100|IND_OPER|CNPJ|DT_EMIS|VL_DOC|...|
const IDX_F100 = { IND_OPER: 2, CNPJ: 3, VL_DOC: 5 } as const;

interface Participante {
  nome: string;
  cnpj: string;
  cnpjRaiz: string;
}

export function parseEfdContribuicoes(buffer: Buffer): FatoParticipante[] {
  // Mapa de participantes do 0150 (por COD_PART para A100)
  const partPorCodigo = new Map<string, Participante>();
  // Mapa reverso CNPJ→Participante (para lookup de F100)
  const partPorCnpj = new Map<string, Participante>();

  // chave: `${codPart|cnpj}|${CLIENTE|FORNECEDOR}`
  const agregados = new Map<string, { valor: number; qtd: number; part: Participante }>();

  for (const raw of iterLines(buffer)) {
    const fields = raw.split('|');
    const reg = fields[1];

    if (reg === '0150') {
      const codPart = fields[IDX_0150.COD_PART] ?? '';
      if (!codPart) continue;
      const nome = fields[IDX_0150.NOME] ?? '';
      const cnpj = (fields[IDX_0150.CNPJ] ?? '').replace(/\D/g, '').padStart(14, '0');
      const p: Participante = { nome, cnpj, cnpjRaiz: cnpj.slice(0, 8) };
      partPorCodigo.set(codPart, p);
      if (cnpj) partPorCnpj.set(cnpj, p);

    } else if (reg === 'A100') {
      // Bloco A — serviços ISS: usa COD_PART → 0150
      const codSit = fields[IDX_A100.COD_SIT] ?? '';
      if (codSit !== '00') continue;

      const codPart = fields[IDX_A100.COD_PART] ?? '';
      if (!codPart) continue;

      const part = partPorCodigo.get(codPart);
      if (!part) continue; // sem cadastro 0150 — sem CNPJ identificável

      const tipo: 'CLIENTE' | 'FORNECEDOR' =
        (fields[IDX_A100.IND_OPER] ?? '') === '1' ? 'CLIENTE' : 'FORNECEDOR';
      const vlDoc = parseBr(fields[IDX_A100.VL_DOC] ?? '0');

      const key = `A|${codPart}|${tipo}`;
      const agg = agregados.get(key) ?? { valor: 0, qtd: 0, part };
      agg.valor += vlDoc;
      agg.qtd += 1;
      agregados.set(key, agg);

    } else if (reg === 'F100') {
      // Bloco F — demais documentos: usa CNPJ diretamente
      const cnpjRaw = (fields[IDX_F100.CNPJ] ?? '').replace(/\D/g, '').padStart(14, '0');
      if (!cnpjRaw || cnpjRaw === '00000000000000') continue;

      const tipo: 'CLIENTE' | 'FORNECEDOR' =
        (fields[IDX_F100.IND_OPER] ?? '') === '1' ? 'CLIENTE' : 'FORNECEDOR';
      const vlDoc = parseBr(fields[IDX_F100.VL_DOC] ?? '0');

      // Tenta resolver razão social via 0150; caso não encontre, deixa vazio
      const part: Participante = partPorCnpj.get(cnpjRaw) ?? {
        nome: '',
        cnpj: cnpjRaw,
        cnpjRaiz: cnpjRaw.slice(0, 8),
      };

      const key = `F|${cnpjRaw}|${tipo}`;
      const agg = agregados.get(key) ?? { valor: 0, qtd: 0, part };
      agg.valor += vlDoc;
      agg.qtd += 1;
      agregados.set(key, agg);
    }
  }

  const result: FatoParticipante[] = [];
  for (const [key, { valor, qtd, part }] of agregados) {
    // Extrai tipo do final da chave
    const tipo = key.endsWith('|CLIENTE') ? 'CLIENTE' : 'FORNECEDOR';
    // codPart: segundo segmento da chave (A|codPart|tipo ou F|cnpj|tipo)
    const segments = key.split('|');
    const codPart = segments[1] ?? '';

    result.push({
      codPart,
      cnpj:               part.cnpj,
      cnpjRaiz:           part.cnpjRaiz,
      razaoSocial:        part.nome,
      tipoParticipante:   tipo as 'CLIENTE' | 'FORNECEDOR',
      valorTotal:         valor,
      quantidadeDocumentos: qtd,
    });
  }
  return result;
}
