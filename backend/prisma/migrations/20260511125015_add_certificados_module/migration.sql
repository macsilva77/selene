-- CreateEnum
CREATE TYPE "CertificadoStatus" AS ENUM ('ATIVO', 'VENCIDO', 'REVOGADO', 'INVALIDO', 'EXPIRACAO_PROXIMA');

-- CreateEnum
CREATE TYPE "CertificadoAcao" AS ENUM ('UPLOAD', 'ASSOCIACAO', 'USO', 'REMOCAO', 'VISUALIZACAO');

-- CreateTable
CREATE TABLE "certificados_digitais" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "razao_social" TEXT NOT NULL,
    "cnpj_cert" TEXT NOT NULL,
    "raiz_cnpj" TEXT NOT NULL,
    "numero_serie" TEXT NOT NULL,
    "autoridade_cert" TEXT NOT NULL,
    "data_emissao" TIMESTAMP(3) NOT NULL,
    "data_validade" TIMESTAMP(3) NOT NULL,
    "thumbprint" TEXT NOT NULL,
    "status" "CertificadoStatus" NOT NULL,
    "storage_key" TEXT,
    "storage_iv" TEXT,
    "nome_arquivo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "criado_por_id" TEXT NOT NULL,

    CONSTRAINT "certificados_digitais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificados_empresas" (
    "certificado_id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "associado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificados_empresas_pkey" PRIMARY KEY ("certificado_id","empresa_id")
);

-- CreateTable
CREATE TABLE "procuracoes_eletronicas" (
    "id" TEXT NOT NULL,
    "certificado_id" TEXT NOT NULL,
    "cnpj_outorgante" TEXT NOT NULL,
    "cpf_cnpj_outorgado" TEXT NOT NULL,
    "nome_outorgado" TEXT NOT NULL,
    "poderes_delegados" TEXT NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_validade_proc" DATE NOT NULL,
    "storage_key" TEXT,
    "nome_arquivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procuracoes_eletronicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificados_logs" (
    "id" BIGSERIAL NOT NULL,
    "certificado_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "usuario_nome" TEXT,
    "acao" "CertificadoAcao" NOT NULL,
    "descricao" TEXT,
    "ip_origem" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificados_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "certificados_digitais_tenant_id_status_idx" ON "certificados_digitais"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "certificados_digitais_tenant_id_raiz_cnpj_idx" ON "certificados_digitais"("tenant_id", "raiz_cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "certificados_digitais_tenant_id_thumbprint_key" ON "certificados_digitais"("tenant_id", "thumbprint");

-- CreateIndex
CREATE UNIQUE INDEX "procuracoes_eletronicas_certificado_id_key" ON "procuracoes_eletronicas"("certificado_id");

-- CreateIndex
CREATE INDEX "certificados_logs_certificado_id_idx" ON "certificados_logs"("certificado_id");

-- CreateIndex
CREATE INDEX "certificados_logs_tenant_id_criado_em_idx" ON "certificados_logs"("tenant_id", "criado_em");

-- AddForeignKey
ALTER TABLE "certificados_digitais" ADD CONSTRAINT "certificados_digitais_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificados_digitais" ADD CONSTRAINT "certificados_digitais_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificados_empresas" ADD CONSTRAINT "certificados_empresas_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificados_digitais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificados_empresas" ADD CONSTRAINT "certificados_empresas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procuracoes_eletronicas" ADD CONSTRAINT "procuracoes_eletronicas_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificados_digitais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificados_logs" ADD CONSTRAINT "certificados_logs_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificados_digitais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
