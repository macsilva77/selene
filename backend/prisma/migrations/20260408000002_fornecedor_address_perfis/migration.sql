-- AlterTable fornecedores: add address fields
ALTER TABLE "fornecedores"
  ADD COLUMN IF NOT EXISTS "nome_fantasia" TEXT,
  ADD COLUMN IF NOT EXISTS "cep"           VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "logradouro"    TEXT,
  ADD COLUMN IF NOT EXISTS "numero"        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "complemento"   TEXT,
  ADD COLUMN IF NOT EXISTS "bairro"        TEXT,
  ADD COLUMN IF NOT EXISTS "municipio"     TEXT,
  ADD COLUMN IF NOT EXISTS "uf"            VARCHAR(2);

-- CreateTable perfis
CREATE TABLE IF NOT EXISTS "perfis" (
  "id"           TEXT        NOT NULL,
  "tenant_id"    TEXT        NOT NULL,
  "nome"         TEXT        NOT NULL,
  "descricao"    TEXT,
  "role"         "Role"      NOT NULL,
  "ativo"        BOOLEAN     NOT NULL DEFAULT true,
  "criado_em"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "perfis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "perfis_tenant_id_nome_key" ON "perfis"("tenant_id", "nome");

ALTER TABLE "perfis"
  DROP CONSTRAINT IF EXISTS "perfis_tenant_id_fkey";
ALTER TABLE "perfis"
  ADD CONSTRAINT "perfis_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable usuario_perfis
CREATE TABLE IF NOT EXISTS "usuario_perfis" (
  "usuario_id"    TEXT        NOT NULL,
  "perfil_id"     TEXT        NOT NULL,
  "atribuido_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "usuario_perfis_pkey" PRIMARY KEY ("usuario_id", "perfil_id")
);

ALTER TABLE "usuario_perfis"
  DROP CONSTRAINT IF EXISTS "usuario_perfis_usuario_id_fkey";
ALTER TABLE "usuario_perfis"
  ADD CONSTRAINT "usuario_perfis_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "usuario_perfis"
  DROP CONSTRAINT IF EXISTS "usuario_perfis_perfil_id_fkey";
ALTER TABLE "usuario_perfis"
  ADD CONSTRAINT "usuario_perfis_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
