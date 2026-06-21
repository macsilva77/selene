/**
 * Códigos referenciais RFB para captura de dívida financeira (Fase 3).
 *
 * Identificação por CÓDIGO referencial (nunca por descrição). Somar por código
 * usando o nível sintético adequado evita dupla contagem com as analíticas filhas.
 *
 * Confirmados via golden SESSION BRASIL (AC2024): 2.01.01.07 (CP) e 2.02.01.01 (LP).
 *
 * EXTENSÃO: correlatas do plano referencial (debêntures, arrendamento mercantil,
 * partes relacionadas financeiras) devem ser adicionadas AQUI quando confirmadas
 * na tabela oficial da RFB — preferimos um gap documentado a superestimar a dívida
 * com um código não verificado.
 */

// Empréstimos / Financiamentos — Passivo Circulante.
export const DIVIDA_FINANCEIRA_CP: readonly string[] = [
  '2.01.01.07', // Empréstimos ou Financiamentos - Circulante
];

// Empréstimos / Financiamentos — Passivo Não Circulante.
export const DIVIDA_FINANCEIRA_LP: readonly string[] = [
  '2.02.01.01', // Empréstimos e Financiamentos - Longo Prazo
];

// ─── Semântica referencial de contas-folha da DRE (Fase 4) ───────────────────
//
// Receitas/despesas financeiras e D&A estão ESPALHADAS em contas-folha de 05/07/09.
// Classificá-las por descrição é frágil → mapa por CÓDIGO referencial, versionado
// por COD_VER. Necessário para isolar o Resultado Financeiro (EBIT) e o add-back
// de D&A (EBITDA). Sementes confirmadas via golden SESSION BRASIL (AC2024).

export type SemanticaConta =
  | 'RECEITA_FINANCEIRA' | 'DESPESA_FINANCEIRA'
  | 'DEPRECIACAO' | 'AMORTIZACAO' | 'EXAUSTAO';

// Mapa base (aplicável aos leiautes referenciais AC2021+, COD_VER 9–12).
// EXTENSÃO: completar com juros ativos/passivos, descontos, variações cambiais/
// monetárias e AVP pela tabela oficial da RFB — incompletude é pega pelo guard
// de reconciliação [VALID-B] e pelo orphan-log (não silencia).
const SEMANTICA_BASE: Readonly<Record<string, SemanticaConta>> = {
  '3.01.01.05.01.05': 'RECEITA_FINANCEIRA', // Outras Receitas Financeiras
  '3.01.01.09.01.08': 'DESPESA_FINANCEIRA', // Outras Despesas Financeiras
  '3.01.01.07.01.23': 'DEPRECIACAO',        // Encargos de Depreciação
  '3.01.01.07.01.24': 'AMORTIZACAO',        // Encargos de Amortização
};

/** Semântica referencial de uma conta-folha (undefined = segue o rollup da árvore). */
export function semanticaDaConta(codigo: string, _codVer?: number): SemanticaConta | undefined {
  // _codVer reservado para mapas específicos por versão de leiaute (futuro).
  return SEMANTICA_BASE[codigo];
}

/** Sub-blocos onde residem contas financeiras — usados pelo orphan-log de completude. */
export const GRUPOS_FINANCEIROS: readonly string[] = ['3.01.01.05', '3.01.01.07', '3.01.01.09'];
