/**
 * Versões dos prompts/contratos de cada etapa do pipeline de análise de crédito.
 * Centralizado aqui para evitar divergências entre serviços (ex: P02 referenciar
 * versão antiga do P01 e nunca encontrar exercícios processados).
 *
 * Ao incrementar uma versão:
 *   1. Atualizar a constante aqui
 *   2. O pipeline vai reprocessar todos os exercícios (idempotência por versão)
 */
export const VERSAO_P01 = 'P01-v5';
export const VERSAO_P02 = 'P02-v4';
export const VERSAO_P03 = 'P03-v2';
export const VERSAO_P04 = 'P04-v1';
