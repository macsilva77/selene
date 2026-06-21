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
