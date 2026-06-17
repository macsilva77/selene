-- Migration: colunas CFOP pré-categorizadas em faturamento_competencias
--
-- Motivação: o endpoint cfops-consolidado fazia string_agg do cfops_json (campo Text)
-- de todos os meses de um ano, enviava para Node.js e recategorizava em JS.
-- Com estas colunas, o read é um SUM() puro — nenhum JSON gerado ou parseado.
--
-- Os valores são populados na escrita (processarArquivo / mesclarCompetencias).
-- Registros existentes ficam com default 0; reprocessar os SPEDs os preenche.

ALTER TABLE faturamento_competencias
  ADD COLUMN IF NOT EXISTS vl_estaduais      DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vl_interestaduais DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vl_exportacoes    DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vl_devolucoes     DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vl_transferencias DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vl_remessas       DECIMAL(18,2) NOT NULL DEFAULT 0;
