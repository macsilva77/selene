-- CreateTable
CREATE TABLE "revisores_doc_reg" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "ordem" INTEGER,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "aprovado" BOOLEAN,
    "comentario" TEXT,
    "respondido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revisores_doc_reg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revisores_doc_reg_documento_id_usuario_id_key" ON "revisores_doc_reg"("documento_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "revisores_doc_reg" ADD CONSTRAINT "revisores_doc_reg_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_reg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisores_doc_reg" ADD CONSTRAINT "revisores_doc_reg_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
