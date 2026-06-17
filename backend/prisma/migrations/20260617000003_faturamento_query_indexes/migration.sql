-- Migration: índices otimizados para queries de consolidado de faturamento
--
-- Problema: o índice UNIQUE (tenant_id, empresa_id, ano, mes, fonte) coloca
-- 'ano' antes de 'fonte'. Quando a query filtra com fonte=? AND ano BETWEEN x AND y,
-- o PostgreSQL usa o índice até 'ano' (range) mas precisa filtrar 'fonte' fora do
-- índice — o que exige um scan extra.
--
-- Solução: índice dedicado para as queries de consolidado/cfops-consolidado que
-- filtram (tenant_id, empresa_id, fonte) + range em ano.

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_fat_comp_tenant_empresa_fonte_ano
ON faturamento_competencias (tenant_id, empresa_id, fonte, ano);

-- Índice para o endpoint /anual que filtra por (tenant_id, cnpj, ano, fonte)
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_fat_comp_tenant_cnpj_ano_fonte
ON faturamento_competencias (tenant_id, cnpj, ano, fonte);
