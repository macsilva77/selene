-- CreateTable
CREATE TABLE "unidade_visibilidades" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "origem_id" TEXT NOT NULL,
    "alvo_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id" TEXT NOT NULL,

    CONSTRAINT "unidade_visibilidades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidade_visibilidades_tenant_id_origem_id_idx" ON "unidade_visibilidades"("tenant_id", "origem_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidade_visibilidades_tenant_id_origem_id_alvo_id_key" ON "unidade_visibilidades"("tenant_id", "origem_id", "alvo_id");

-- AddForeignKey
ALTER TABLE "unidade_visibilidades" ADD CONSTRAINT "unidade_visibilidades_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_visibilidades" ADD CONSTRAINT "unidade_visibilidades_origem_id_fkey" FOREIGN KEY ("origem_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_visibilidades" ADD CONSTRAINT "unidade_visibilidades_alvo_id_fkey" FOREIGN KEY ("alvo_id") REFERENCES "unidades_organizacionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_visibilidades" ADD CONSTRAINT "unidade_visibilidades_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
