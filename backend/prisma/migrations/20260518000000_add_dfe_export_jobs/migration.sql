-- CreateEnum
CREATE TYPE "DfeExportJobStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'ERRO');

-- CreateTable
CREATE TABLE "dfe_export_jobs" (
    "id"               TEXT NOT NULL,
    "tenant_id"        TEXT NOT NULL,
    "usuario_id"       TEXT,
    "status"           "DfeExportJobStatus" NOT NULL DEFAULT 'PENDENTE',
    "email"            TEXT,
    "documento_ids"    TEXT NOT NULL,
    "total_docs"       INTEGER NOT NULL DEFAULT 0,
    "docs_processados" INTEGER NOT NULL DEFAULT 0,
    "arquivo_nome"     TEXT,
    "erro_mensagem"    TEXT,
    "criado_em"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em"    TIMESTAMP(3) NOT NULL,
    "expirado_em"      TIMESTAMP(3),

    CONSTRAINT "dfe_export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dfe_export_jobs_tenant_id_status_idx" ON "dfe_export_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "dfe_export_jobs_tenant_id_criado_em_idx" ON "dfe_export_jobs"("tenant_id", "criado_em");
