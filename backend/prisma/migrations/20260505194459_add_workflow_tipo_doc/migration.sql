-- AlterTable
ALTER TABLE "tipos_documento_reg" ADD COLUMN     "assinatura_sequencial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "exige_revisao" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "workflow_revisores_tipo_doc" (
    "id" TEXT NOT NULL,
    "tipo_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "ordem" INTEGER,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflow_revisores_tipo_doc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_signatarios_tipo_doc" (
    "id" TEXT NOT NULL,
    "tipo_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "ordem" INTEGER,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "workflow_signatarios_tipo_doc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_revisores_tipo_doc_tipo_id_usuario_id_key" ON "workflow_revisores_tipo_doc"("tipo_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_signatarios_tipo_doc_tipo_id_usuario_id_key" ON "workflow_signatarios_tipo_doc"("tipo_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "workflow_revisores_tipo_doc" ADD CONSTRAINT "workflow_revisores_tipo_doc_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "tipos_documento_reg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_revisores_tipo_doc" ADD CONSTRAINT "workflow_revisores_tipo_doc_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_signatarios_tipo_doc" ADD CONSTRAINT "workflow_signatarios_tipo_doc_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "tipos_documento_reg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_signatarios_tipo_doc" ADD CONSTRAINT "workflow_signatarios_tipo_doc_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
