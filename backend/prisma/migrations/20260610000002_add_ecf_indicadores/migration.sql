-- CreateTable
CREATE TABLE "ecf_indicadores" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "cnpj" VARCHAR(14) NOT NULL,
  "razao_social" TEXT NOT NULL,
  "ano_calendario" INTEGER NOT NULL,
  "forma_tributacao" VARCHAR(30) NOT NULL,
  "faturamento_declarado" DECIMAL(18,2) NOT NULL,
  "prejuizo_fiscal_acumulado" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "base_negativa_csll" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "exercicio_ecf" VARCHAR(20) NOT NULL,
  "gcs_uri" TEXT NOT NULL,
  "hash_arquivo" VARCHAR(64) NOT NULL,
  "versao_processo" VARCHAR(20) NOT NULL DEFAULT '1.0',
  "processado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ecf_indicadores_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ecf_indicadores_tenantId_empresaId_anoCalendario_key"
  ON "ecf_indicadores"("tenant_id", "empresa_id", "ano_calendario");

-- CreateIndex
CREATE INDEX "ecf_indicadores_tenant_id_cnpj_idx"
  ON "ecf_indicadores"("tenant_id", "cnpj");

-- AddForeignKey
ALTER TABLE "ecf_indicadores"
  ADD CONSTRAINT "ecf_indicadores_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
