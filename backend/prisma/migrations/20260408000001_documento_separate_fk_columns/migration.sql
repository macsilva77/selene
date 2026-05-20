-- Adiciona colunas FK separadas e opcionais por tipo de entidade
ALTER TABLE "documentos" ADD COLUMN IF NOT EXISTS "contrato_id"     TEXT;
ALTER TABLE "documentos" ADD COLUMN IF NOT EXISTS "pendencia_id"    TEXT;
ALTER TABLE "documentos" ADD COLUMN IF NOT EXISTS "iniciativa_id"   TEXT;
ALTER TABLE "documentos" ADD COLUMN IF NOT EXISTS "processo_id"     TEXT;
ALTER TABLE "documentos" ADD COLUMN IF NOT EXISTS "movimentacao_id" TEXT;

-- Popula as colunas FK a partir de entidade_tipo + entidade_id existente
UPDATE "documentos" SET "contrato_id"     = "entidade_id" WHERE "entidade_tipo" = 'contrato';
UPDATE "documentos" SET "pendencia_id"    = "entidade_id" WHERE "entidade_tipo" = 'pendencia';
UPDATE "documentos" SET "iniciativa_id"   = "entidade_id" WHERE "entidade_tipo" = 'iniciativa';
UPDATE "documentos" SET "processo_id"     = "entidade_id" WHERE "entidade_tipo" = 'processo';
UPDATE "documentos" SET "movimentacao_id" = "entidade_id" WHERE "entidade_tipo" = 'movimentacao';

-- Remove as FK constraints polimórficas quebradas (mesma coluna → múltiplas tabelas)
ALTER TABLE "documentos" DROP CONSTRAINT IF EXISTS "doc_contrato_fk";
ALTER TABLE "documentos" DROP CONSTRAINT IF EXISTS "doc_pendencia_fk";
ALTER TABLE "documentos" DROP CONSTRAINT IF EXISTS "doc_iniciativa_fk";
ALTER TABLE "documentos" DROP CONSTRAINT IF EXISTS "doc_processo_fk";
ALTER TABLE "documentos" DROP CONSTRAINT IF EXISTS "doc_movimentacao_fk";

-- Adiciona FK constraints corretas sobre as novas colunas separadas
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_contrato_id_fkey"
  FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documentos" ADD CONSTRAINT "documentos_pendencia_id_fkey"
  FOREIGN KEY ("pendencia_id") REFERENCES "pendencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documentos" ADD CONSTRAINT "documentos_iniciativa_id_fkey"
  FOREIGN KEY ("iniciativa_id") REFERENCES "iniciativas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documentos" ADD CONSTRAINT "documentos_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos_licitatorios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documentos" ADD CONSTRAINT "documentos_movimentacao_id_fkey"
  FOREIGN KEY ("movimentacao_id") REFERENCES "movimentacoes_pendencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
