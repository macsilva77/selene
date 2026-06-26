-- AlterTable
ALTER TABLE "nfse_documentos" ADD COLUMN     "nsu" TEXT;

-- AlterTable
ALTER TABLE "nfse_eventos" ADD COLUMN     "nsu" TEXT;

-- CreateIndex
CREATE INDEX "nfse_documentos_tenant_id_cnpj_titular_nsu_idx" ON "nfse_documentos"("tenant_id", "cnpj_titular", "nsu");

