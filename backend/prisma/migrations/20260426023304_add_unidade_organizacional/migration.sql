-- CreateEnum
CREATE TYPE "TipoUnidade" AS ENUM ('UA', 'UG');

-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "unidade_id" TEXT;

-- AlterTable
ALTER TABLE "iniciativas" ADD COLUMN     "unidade_id" TEXT;

-- AlterTable
ALTER TABLE "pendencias" ADD COLUMN     "unidade_id" TEXT;

-- CreateTable
CREATE TABLE "unidades_organizacionais" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" VARCHAR(200) NOT NULL,
    "sigla" VARCHAR(20),
    "tipo" "TipoUnidade" NOT NULL,
    "responsavel_id" TEXT,
    "pai_id" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "data_vigencia_inicio" DATE,
    "data_vigencia_fim" DATE,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_organizacionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_unidades" (
    "usuario_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "atribuido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_unidades_pkey" PRIMARY KEY ("usuario_id","unidade_id")
);

-- CreateIndex
CREATE INDEX "unidades_organizacionais_tenant_id_idx" ON "unidades_organizacionais"("tenant_id");

-- CreateIndex
CREATE INDEX "unidades_organizacionais_pai_id_idx" ON "unidades_organizacionais"("pai_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_organizacionais_tenant_id_sigla_key" ON "unidades_organizacionais"("tenant_id", "sigla");

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iniciativas" ADD CONSTRAINT "iniciativas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_organizacionais" ADD CONSTRAINT "unidades_organizacionais_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_organizacionais" ADD CONSTRAINT "unidades_organizacionais_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_organizacionais" ADD CONSTRAINT "unidades_organizacionais_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "unidades_organizacionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_unidades" ADD CONSTRAINT "usuario_unidades_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_unidades" ADD CONSTRAINT "usuario_unidades_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
