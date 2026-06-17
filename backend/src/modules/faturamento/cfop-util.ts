/**
 * Utilitário compartilhado de categorização de CFOPs.
 *
 * Usado tanto na escrita (faturamento-processamento.service.ts) quanto
 * na leitura (faturamento-query.service.ts), garantindo categorização
 * consistente sem duplicação de lógica.
 */

export interface CfopCategorias {
  vlEstaduais:      number;
  vlInterestaduais: number;
  vlExportacoes:    number;
  vlDevolucoes:     number;
  vlTransferencias: number;
  vlRemessas:       number;
}

export const CFOP_ZERO: Readonly<CfopCategorias> = {
  vlEstaduais: 0, vlInterestaduais: 0, vlExportacoes: 0,
  vlDevolucoes: 0, vlTransferencias: 0, vlRemessas: 0,
};

// CFOPs de devolução de compra (saída para devolver ao fornecedor)
export const CFOP_DEVOLUCAO = new Set([
  '5201','5202','5210','5410','5411','5412','5413','5414','5415',
  '6201','6202','6210','6410','6411','6412','6413','6414','6415',
  '7201','7202',
]);

// CFOPs de transferência entre estabelecimentos da mesma empresa
export const CFOP_TRANSFERENCIA = new Set([
  '5151','5152','5153','5155','5156',
  '6151','6152','6153','6155','6156',
  '7151','7152',
]);

/**
 * Categoriza um array de entradas CFOP ({cfop, vlOpr}) nas 6 categorias fiscais.
 * Usado na escrita do SPED para pré-calcular e persistir colunas desnormalizadas.
 */
export function categorizarCfopsArray(
  cfops: ReadonlyArray<{ cfop: string; vlOpr: number }>,
): CfopCategorias {
  let vlEstaduais = 0, vlInterestaduais = 0, vlExportacoes = 0;
  let vlDevolucoes = 0, vlTransferencias = 0, vlRemessas = 0;

  for (const { cfop, vlOpr } of cfops) {
    if (!cfop || vlOpr == null) continue;
    const v = Number(vlOpr);
    const p = cfop[0];
    if      (CFOP_DEVOLUCAO.has(cfop))           vlDevolucoes    += v;
    else if (CFOP_TRANSFERENCIA.has(cfop))        vlTransferencias += v;
    else if (p === '5' && cfop >= '5900')         vlRemessas       += v;
    else if (p === '6' && cfop >= '6900')         vlRemessas       += v;
    else if (p === '7' && cfop >= '7900')         vlRemessas       += v;
    else if (p === '5')                           vlEstaduais      += v;
    else if (p === '6')                           vlInterestaduais += v;
    else if (p === '7')                           vlExportacoes    += v;
  }

  return { vlEstaduais, vlInterestaduais, vlExportacoes, vlDevolucoes, vlTransferencias, vlRemessas };
}
