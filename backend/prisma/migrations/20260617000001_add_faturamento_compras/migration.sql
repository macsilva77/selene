-- Migration: Adiciona campos de compras/entradas à tabela faturamento_competencias
-- Extrai C100 com IND_OPER=0 (entradas) do EFD ICMS/IPI

ALTER TABLE faturamento_competencias
  ADD COLUMN IF NOT EXISTS vl_compras_bruto       DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qtd_documentos_compras INT           NOT NULL DEFAULT 0;
