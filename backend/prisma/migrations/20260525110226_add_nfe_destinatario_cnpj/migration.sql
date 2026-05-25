-- AlterTable
ALTER TABLE "dfe_documentos" ADD COLUMN     "nfe_destinatario_cnpj" TEXT;

-- CreateIndex
CREATE INDEX "dfe_documentos_tenant_id_nfe_destinatario_cnpj_idx" ON "dfe_documentos"("tenant_id", "nfe_destinatario_cnpj");
