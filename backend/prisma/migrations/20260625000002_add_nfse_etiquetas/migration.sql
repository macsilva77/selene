-- CreateTable
CREATE TABLE "nfse_documento_etiquetas" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "etiqueta_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfse_documento_etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfse_etiqueta_historico" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "etiquetas_antes" JSONB NOT NULL,
    "etiquetas_depois" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfse_etiqueta_historico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nfse_documento_etiquetas_etiqueta_id_idx" ON "nfse_documento_etiquetas"("etiqueta_id");

-- CreateIndex
CREATE UNIQUE INDEX "nfse_documento_etiquetas_documento_id_etiqueta_id_key" ON "nfse_documento_etiquetas"("documento_id", "etiqueta_id");

-- CreateIndex
CREATE INDEX "nfse_etiqueta_historico_documento_id_criado_em_idx" ON "nfse_etiqueta_historico"("documento_id", "criado_em");

-- AddForeignKey
ALTER TABLE "nfse_documento_etiquetas" ADD CONSTRAINT "nfse_documento_etiquetas_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "nfse_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_documento_etiquetas" ADD CONSTRAINT "nfse_documento_etiquetas_etiqueta_id_fkey" FOREIGN KEY ("etiqueta_id") REFERENCES "etiquetas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_etiqueta_historico" ADD CONSTRAINT "nfse_etiqueta_historico_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "nfse_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_etiqueta_historico" ADD CONSTRAINT "nfse_etiqueta_historico_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

