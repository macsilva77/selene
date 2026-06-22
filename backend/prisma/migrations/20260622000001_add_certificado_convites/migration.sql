-- Migration: Convites de onboarding de certificado A1
-- Link público para o cliente enviar o próprio certificado; a empresa é criada
-- automaticamente a partir dos dados do certificado quando o convite é usado.

-- CreateEnum
CREATE TYPE "ConviteCertificadoStatus" AS ENUM ('PENDENTE', 'USADO', 'EXPIRADO', 'REVOGADO');

-- CreateTable
CREATE TABLE "certificados_convites" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "token_hash"     TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "apelido"        TEXT,
  "status"         "ConviteCertificadoStatus" NOT NULL DEFAULT 'PENDENTE',
  "expira_em"      TIMESTAMP(3) NOT NULL,
  "usado_em"       TIMESTAMP(3),
  "ip_uso"         TEXT,
  "criado_por_id"  TEXT NOT NULL,
  "certificado_id" TEXT,
  "empresa_id"     TEXT,
  "razao_social"   TEXT,
  "cnpj"           TEXT,
  "criado_em"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "atualizado_em"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "certificados_convites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "certificados_convites_token_hash_key" ON "certificados_convites" ("token_hash");
CREATE INDEX "certificados_convites_tenant_id_status_idx" ON "certificados_convites" ("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "certificados_convites"
  ADD CONSTRAINT "certificados_convites_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "certificados_convites"
  ADD CONSTRAINT "certificados_convites_criado_por_id_fkey"
  FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
