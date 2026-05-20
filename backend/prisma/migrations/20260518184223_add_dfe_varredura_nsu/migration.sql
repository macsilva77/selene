-- CreateEnum
CREATE TYPE "DfeVarreduraStatus" AS ENUM ('ATIVA', 'PAUSADA', 'CONCLUIDA', 'ERRO');

-- CreateTable
CREATE TABLE "dfe_varreduras_nsu" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "status" "DfeVarreduraStatus" NOT NULL DEFAULT 'PAUSADA',
    "nsu_inicio" TEXT NOT NULL,
    "nsu_fim" TEXT NOT NULL,
    "nsu_atual" TEXT NOT NULL,
    "total_consultado" INTEGER NOT NULL DEFAULT 0,
    "total_recuperado" INTEGER NOT NULL DEFAULT 0,
    "iniciado_em" TIMESTAMP(3),
    "pausado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "ultimo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dfe_varreduras_nsu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dfe_varreduras_nsu_config_id_key" ON "dfe_varreduras_nsu"("config_id");

-- CreateIndex
CREATE INDEX "dfe_varreduras_nsu_tenant_id_status_idx" ON "dfe_varreduras_nsu"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "dfe_varreduras_nsu" ADD CONSTRAINT "dfe_varreduras_nsu_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "dfe_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
