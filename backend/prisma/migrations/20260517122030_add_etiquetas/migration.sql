-- CreateTable
CREATE TABLE "etiquetas" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "cor" VARCHAR(7) NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "deletado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dfe_documento_etiquetas" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "etiqueta_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dfe_documento_etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etiquetas_tenant_id_deletado_em_idx" ON "etiquetas"("tenant_id", "deletado_em");

-- CreateIndex
CREATE INDEX "dfe_documento_etiquetas_etiqueta_id_idx" ON "dfe_documento_etiquetas"("etiqueta_id");

-- CreateIndex
CREATE UNIQUE INDEX "dfe_documento_etiquetas_documento_id_etiqueta_id_key" ON "dfe_documento_etiquetas"("documento_id", "etiqueta_id");

-- AddForeignKey
ALTER TABLE "etiquetas" ADD CONSTRAINT "etiquetas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_documento_etiquetas" ADD CONSTRAINT "dfe_documento_etiquetas_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "dfe_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_documento_etiquetas" ADD CONSTRAINT "dfe_documento_etiquetas_etiqueta_id_fkey" FOREIGN KEY ("etiqueta_id") REFERENCES "etiquetas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
