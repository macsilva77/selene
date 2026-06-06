-- Migration: add credito_ecf_arquivos
-- Armazena metadados do Parquet gerado pelo P01 (path no GCS, trimestres disponíveis, hash).
-- O arquivo .txt original continua em GCS; apenas o Parquet é referenciado aqui.

CREATE TABLE IF NOT EXISTS "credito_ecf_arquivos" (
  "id"            TEXT         NOT NULL,
  "empresa_id"    TEXT         NOT NULL,
  "exercicio"     INTEGER      NOT NULL,
  "gcs_path"      TEXT         NOT NULL,
  "gcs_path_ecf"  TEXT         NOT NULL,
  "trimestres"    INTEGER[]    NOT NULL DEFAULT '{}',
  "registros"     INTEGER      NOT NULL DEFAULT 0,
  "hash_md5"      VARCHAR(32)  NOT NULL,
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "credito_ecf_arquivos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "credito_ecf_arquivos_empresa_id_exercicio_key"
  ON "credito_ecf_arquivos"("empresa_id", "exercicio");

CREATE INDEX IF NOT EXISTS "credito_ecf_arquivos_empresa_id_idx"
  ON "credito_ecf_arquivos"("empresa_id");

ALTER TABLE "credito_ecf_arquivos"
  ADD CONSTRAINT "credito_ecf_arquivos_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
