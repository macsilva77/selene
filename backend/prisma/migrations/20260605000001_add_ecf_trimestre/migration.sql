-- AddColumn trimestre to credito_ecf_registros
ALTER TABLE "credito_ecf_registros" ADD COLUMN "trimestre" INTEGER NOT NULL DEFAULT 0;

-- DropIndex old unique (sem trimestre)
DROP INDEX "credito_ecf_registros_empresa_id_exercicio_registro_ecf_linh_key";

-- CreateIndex new unique (com trimestre)
CREATE UNIQUE INDEX "credito_ecf_registros_empresa_id_exercicio_registro_ecf_trim_key"
  ON "credito_ecf_registros"("empresa_id", "exercicio", "registro_ecf", "trimestre", "linha_codigo");
