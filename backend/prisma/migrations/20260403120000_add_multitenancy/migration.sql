-- CreateEnum
CREATE TYPE "PlanoTenant" AS ENUM ('free', 'starter', 'professional', 'enterprise');

-- CreateTable: tenants (deve existir antes do backfill)
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cnpj" TEXT,
    "plano" "PlanoTenant" NOT NULL DEFAULT 'free',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "tenants_cnpj_key" ON "tenants"("cnpj");

-- Inserir tenant padrão para dados existentes (backfill)
INSERT INTO "tenants" ("id", "nome", "slug", "plano", "ativo", "criado_em", "atualizado_em")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Tenant Padrão',
  'default',
  'professional',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- DropIndex (unique simples → unique composto com tenantId)
DROP INDEX IF EXISTS "config_licitacoes_modalidade_contrato_key";
DROP INDEX IF EXISTS "config_notificacoes_evento_tipo_key";
DROP INDEX IF EXISTS "contratos_numero_key";
DROP INDEX IF EXISTS "fornecedores_cnpj_key";
DROP INDEX IF EXISTS "processos_licitatorios_numero_key";
DROP INDEX IF EXISTS "usuarios_email_key";

-- AlterTable: adiciona tenant_id nullable primeiro, faz backfill, depois torna NOT NULL
ALTER TABLE "audit_logs" ADD COLUMN "tenant_id" TEXT;

ALTER TABLE "config_licitacoes" ADD COLUMN "tenant_id" TEXT;
UPDATE "config_licitacoes" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "config_licitacoes" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "config_notificacoes" ADD COLUMN "tenant_id" TEXT;
UPDATE "config_notificacoes" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "config_notificacoes" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "contratos" ADD COLUMN "tenant_id" TEXT;
UPDATE "contratos" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "contratos" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "documentos" ADD COLUMN "tenant_id" TEXT;
UPDATE "documentos" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "documentos" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "fornecedores" ADD COLUMN "tenant_id" TEXT;
UPDATE "fornecedores" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "fornecedores" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "iniciativas" ADD COLUMN "tenant_id" TEXT;
UPDATE "iniciativas" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "iniciativas" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "notificacoes" ADD COLUMN "tenant_id" TEXT;
UPDATE "notificacoes" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "notificacoes" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "pendencias" ADD COLUMN "tenant_id" TEXT;
UPDATE "pendencias" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "pendencias" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "processos_licitatorios" ADD COLUMN "tenant_id" TEXT;
UPDATE "processos_licitatorios" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "processos_licitatorios" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "usuarios" ADD COLUMN "tenant_id" TEXT;
UPDATE "usuarios" SET "tenant_id" = '00000000-0000-0000-0000-000000000001' WHERE "tenant_id" IS NULL;
ALTER TABLE "usuarios" ALTER COLUMN "tenant_id" SET NOT NULL;

-- CreateIndex (compostos)
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");
CREATE UNIQUE INDEX "config_licitacoes_tenant_id_modalidade_contrato_key" ON "config_licitacoes"("tenant_id", "modalidade_contrato");
CREATE UNIQUE INDEX "config_notificacoes_tenant_id_evento_tipo_key" ON "config_notificacoes"("tenant_id", "evento_tipo");
CREATE UNIQUE INDEX "contratos_tenant_id_numero_key" ON "contratos"("tenant_id", "numero");
CREATE UNIQUE INDEX "fornecedores_tenant_id_cnpj_key" ON "fornecedores"("tenant_id", "cnpj");
CREATE UNIQUE INDEX "processos_licitatorios_tenant_id_numero_key" ON "processos_licitatorios"("tenant_id", "numero");
CREATE UNIQUE INDEX "usuarios_tenant_id_email_key" ON "usuarios"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "iniciativas" ADD CONSTRAINT "iniciativas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processos_licitatorios" ADD CONSTRAINT "processos_licitatorios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "config_licitacoes" ADD CONSTRAINT "config_licitacoes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "config_notificacoes" ADD CONSTRAINT "config_notificacoes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
