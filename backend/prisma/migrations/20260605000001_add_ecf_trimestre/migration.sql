-- AddColumn trimestre to credito_ecf_registros (safe/idempotent)
ALTER TABLE "credito_ecf_registros"
  ADD COLUMN IF NOT EXISTS "trimestre" INTEGER NOT NULL DEFAULT 0;

-- Drop old unique index (without trimestre) — ignora se já foi removido
DROP INDEX IF EXISTS "credito_ecf_registros_empresa_id_exercicio_registro_ecf_linha_key";

-- Create new unique index (with trimestre) — ignora se já existe
CREATE UNIQUE INDEX IF NOT EXISTS "credito_ecf_registros_empresa_id_exercicio_registro_ecf_trim_key"
  ON "credito_ecf_registros"("empresa_id", "exercicio", "registro_ecf", "trimestre", "linha_codigo");
