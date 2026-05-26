-- CreateEnum
CREATE TYPE "SpedStatus" AS ENUM ('DISPONIVEL', 'ERRO', 'INDISPONIVEL');

-- CreateTable
CREATE TABLE "sped_arquivos" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "gcs_bucket" TEXT NOT NULL,
    "gcs_path" TEXT NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "data_documento" TIMESTAMP(3) NOT NULL,
    "status" "SpedStatus" NOT NULL,
    "mensagem_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sped_arquivos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sped_arquivos_tenant_id_cnpj_idx" ON "sped_arquivos"("tenant_id", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "sped_arquivos_tenant_id_cnpj_tipo_data_documento_key" ON "sped_arquivos"("tenant_id", "cnpj", "tipo", "data_documento");

-- AddForeignKey
ALTER TABLE "sped_arquivos" ADD CONSTRAINT "sped_arquivos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
