-- AlterTable
ALTER TABLE "iniciativas" ADD COLUMN     "board_coluna_id" TEXT;

-- AlterTable
ALTER TABLE "pendencias" ADD COLUMN     "board_coluna_id" TEXT;

-- CreateTable
CREATE TABLE "board_colunas" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "cor" VARCHAR(7),
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "criado_por" TEXT,

    CONSTRAINT "board_colunas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_colunas_tenant_id_ordem_key" ON "board_colunas"("tenant_id", "ordem");

-- AddForeignKey
ALTER TABLE "board_colunas" ADD CONSTRAINT "board_colunas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_colunas" ADD CONSTRAINT "board_colunas_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_board_coluna_id_fkey" FOREIGN KEY ("board_coluna_id") REFERENCES "board_colunas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iniciativas" ADD CONSTRAINT "iniciativas_board_coluna_id_fkey" FOREIGN KEY ("board_coluna_id") REFERENCES "board_colunas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
