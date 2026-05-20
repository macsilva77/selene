-- CreateTable
CREATE TABLE "etiqueta_historico" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "etiquetas_antes" JSONB NOT NULL,
    "etiquetas_depois" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etiqueta_historico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "etiqueta_historico_documento_id_criado_em_idx" ON "etiqueta_historico"("documento_id", "criado_em");

-- AddForeignKey
ALTER TABLE "etiqueta_historico" ADD CONSTRAINT "etiqueta_historico_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "dfe_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etiqueta_historico" ADD CONSTRAINT "etiqueta_historico_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
