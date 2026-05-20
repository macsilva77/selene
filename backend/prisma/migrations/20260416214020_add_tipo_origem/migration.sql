/*
  Warnings:

  - You are about to drop the column `origem` on the `iniciativas` table. All the data in the column will be lost.
  - You are about to drop the column `origem` on the `pendencias` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "iniciativas" DROP COLUMN "origem",
ADD COLUMN     "tipo_origem_id" TEXT;

-- AlterTable
ALTER TABLE "pendencias" DROP COLUMN "origem",
ADD COLUMN     "tipo_origem_id" TEXT;

-- DropEnum
DROP TYPE "PendenciaOrigem";

-- CreateTable
CREATE TABLE "tipos_origem" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_origem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "tipos_origem" ADD CONSTRAINT "tipos_origem_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_tipo_origem_id_fkey" FOREIGN KEY ("tipo_origem_id") REFERENCES "tipos_origem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iniciativas" ADD CONSTRAINT "iniciativas_tipo_origem_id_fkey" FOREIGN KEY ("tipo_origem_id") REFERENCES "tipos_origem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: valores padrão de origem para cada tenant existente
INSERT INTO "tipos_origem" ("id", "tenant_id", "nome", "ativo")
SELECT gen_random_uuid(), t.id, v.nome, true
FROM "tenants" t
CROSS JOIN (VALUES
  ('Auditoria Interna'),
  ('Auditoria Externa'),
  ('Banco Central'),
  ('TCE/AL'),
  ('CGU'),
  ('Outro')
) AS v(nome);
