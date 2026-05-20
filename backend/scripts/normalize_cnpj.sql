-- ============================================================
-- Normalização de CNPJ na tabela empresas
-- Remove pontuação (. / - e espaços) de todos os CNPJs existentes
-- Resultado: 14 caracteres alfanuméricos sem formatação
--
-- Executar manualmente no banco sigic_dev / schema selene_dev
-- ============================================================

SET search_path = selene_dev;

-- Visualização prévia (execute para conferir antes de atualizar)
/*
SELECT
  id,
  cnpj AS cnpj_atual,
  UPPER(REGEXP_REPLACE(cnpj, '[.\-/\s]', '', 'g')) AS cnpj_normalizado
FROM empresas
WHERE cnpj ~ '[.\-/]'
ORDER BY cnpj;
*/

-- Atualização: remove pontos, barras, hífens e espaços, uppercase
UPDATE empresas
SET    cnpj = UPPER(REGEXP_REPLACE(cnpj, '[.\-/\s]', '', 'g'))
WHERE  cnpj ~ '[.\-/]';

-- Verificação pós-atualização (deve retornar 0 linhas)
SELECT id, cnpj
FROM   empresas
WHERE  cnpj !~ '^[A-Z0-9]{14}$';
