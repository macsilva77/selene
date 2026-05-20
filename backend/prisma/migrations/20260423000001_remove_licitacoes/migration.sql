-- Remove módulo de licitações: tabelas processos_licitatorios e config_licitacoes
-- e coluna processo_id da tabela documentos.

ALTER TABLE "documentos" DROP COLUMN IF EXISTS "processo_id";

DROP TABLE IF EXISTS "processos_licitatorios" CASCADE;
DROP TABLE IF EXISTS "config_licitacoes" CASCADE;

-- Remove enums de licitação (só possível se não houver uso remanescente)
DROP TYPE IF EXISTS "TipoLicitacao";
DROP TYPE IF EXISTS "ProcessoStatus";
