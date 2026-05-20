-- CreateEnum
CREATE TYPE "StatusDocReg" AS ENUM ('rascunho', 'em_revisao', 'aguardando_assinaturas', 'vigente', 'arquivado');

-- CreateEnum
CREATE TYPE "TipoRevisaoDoc" AS ENUM ('comentario', 'ajuste_solicitado', 'aprovado');

-- CreateEnum
CREATE TYPE "MetodoAssinatura" AS ENUM ('senha', 'icp_brasil');

-- CreateTable
CREATE TABLE "tipos_documento_reg" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "periodicidade_dias" INTEGER,
    "alerta_antes_dias" INTEGER NOT NULL DEFAULT 30,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_documento_reg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_reg" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tipo_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "versao" TEXT NOT NULL DEFAULT '1.0',
    "status" "StatusDocReg" NOT NULL DEFAULT 'rascunho',
    "storage_key" TEXT,
    "nome_arquivo" TEXT,
    "hash_arquivo" TEXT,
    "data_validade" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "criado_por_id" TEXT NOT NULL,

    CONSTRAINT "documentos_reg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisoes_doc_reg" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "tipo" "TipoRevisaoDoc" NOT NULL DEFAULT 'comentario',
    "texto" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id" TEXT NOT NULL,

    CONSTRAINT "revisoes_doc_reg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatarios_doc_reg" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "ordem" INTEGER,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "signatarios_doc_reg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinaturas_doc_reg" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "assinado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodo" "MetodoAssinatura" NOT NULL DEFAULT 'senha',
    "hash_documento" TEXT NOT NULL,
    "ip" TEXT,
    "certificado_cn" TEXT,

    CONSTRAINT "assinaturas_doc_reg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipos_documento_reg_tenant_id_nome_key" ON "tipos_documento_reg"("tenant_id", "nome");

-- CreateIndex
CREATE INDEX "documentos_reg_tenant_id_status_idx" ON "documentos_reg"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "signatarios_doc_reg_documento_id_usuario_id_key" ON "signatarios_doc_reg"("documento_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_doc_reg_documento_id_usuario_id_key" ON "assinaturas_doc_reg"("documento_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "tipos_documento_reg" ADD CONSTRAINT "tipos_documento_reg_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_reg" ADD CONSTRAINT "documentos_reg_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_reg" ADD CONSTRAINT "documentos_reg_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "tipos_documento_reg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_reg" ADD CONSTRAINT "documentos_reg_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisoes_doc_reg" ADD CONSTRAINT "revisoes_doc_reg_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_reg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisoes_doc_reg" ADD CONSTRAINT "revisoes_doc_reg_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatarios_doc_reg" ADD CONSTRAINT "signatarios_doc_reg_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_reg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatarios_doc_reg" ADD CONSTRAINT "signatarios_doc_reg_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas_doc_reg" ADD CONSTRAINT "assinaturas_doc_reg_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_reg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas_doc_reg" ADD CONSTRAINT "assinaturas_doc_reg_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
