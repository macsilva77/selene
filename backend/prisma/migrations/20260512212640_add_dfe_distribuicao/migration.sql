-- CreateEnum
CREATE TYPE "DfeLoteStatus" AS ENUM ('RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'ERRO', 'REPROCESSAR');

-- CreateEnum
CREATE TYPE "DfeTipoDocumento" AS ENUM ('PROC_NFE', 'PROC_EVENTO_NFE', 'RES_NFE', 'RES_EVENTO');

-- CreateTable
CREATE TABLE "dfe_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "c_uf" INTEGER NOT NULL,
    "tp_amb" INTEGER NOT NULL DEFAULT 1,
    "certificado_id" TEXT NOT NULL,
    "cert_senha_enc" BYTEA NOT NULL,
    "cert_senha_iv" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "criado_por_id" TEXT NOT NULL,

    CONSTRAINT "dfe_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dfe_nsu_controles" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "ultimo_nsu" TEXT NOT NULL DEFAULT '000000000000000',
    "max_nsu" TEXT NOT NULL DEFAULT '000000000000000',
    "ultima_consulta" TIMESTAMP(3),
    "proxima_consulta" TIMESTAMP(3),
    "em_processamento" BOOLEAN NOT NULL DEFAULT false,
    "lock_id" TEXT,
    "lock_ate" TIMESTAMP(3),
    "lock_processo_id" TEXT,
    "total_doc_baixados" INTEGER NOT NULL DEFAULT 0,
    "total_lotes" INTEGER NOT NULL DEFAULT 0,
    "total_erros" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "ultimo_erro_em" TIMESTAMP(3),
    "erros_consecutivos" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dfe_nsu_controles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dfe_lotes" (
    "id" TEXT NOT NULL,
    "controle_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "nsu_enviado" TEXT NOT NULL,
    "c_stat" TEXT NOT NULL,
    "x_motivo" TEXT NOT NULL,
    "ult_nsu_recebido" TEXT NOT NULL,
    "max_nsu_recebido" TEXT NOT NULL,
    "qtd_documentos" INTEGER NOT NULL DEFAULT 0,
    "status" "DfeLoteStatus" NOT NULL DEFAULT 'RECEBIDO',
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "duracao_ms" INTEGER,
    "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizado_em" TIMESTAMP(3),
    "erro_mensagem" TEXT,

    CONSTRAINT "dfe_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dfe_documentos" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj_destinatario" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "tipo_documento" "DfeTipoDocumento" NOT NULL,
    "xml_original" BYTEA NOT NULL,
    "xml_hash" TEXT NOT NULL,
    "chave_acesso" TEXT,
    "nfe_emitente_cnpj" TEXT,
    "nfe_emitente_nome" TEXT,
    "nfe_valor_total" DECIMAL(15,2),
    "nfe_dh_emissao" TIMESTAMP(3),
    "nfe_situacao" TEXT,
    "evento_tipo" TEXT,
    "evento_descricao" TEXT,
    "processado" BOOLEAN NOT NULL DEFAULT false,
    "processado_em" TIMESTAMP(3),
    "erro_processamento" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dfe_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dfe_auditorias" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "nsu_antes" TEXT,
    "nsu_depois" TEXT,
    "c_stat" TEXT,
    "sucesso" BOOLEAN NOT NULL,
    "detalhe" TEXT,
    "duracao_ms" INTEGER,
    "hostname" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dfe_auditorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dfe_configs_tenant_id_ativo_idx" ON "dfe_configs"("tenant_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "dfe_configs_tenant_id_cnpj_key" ON "dfe_configs"("tenant_id", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "dfe_nsu_controles_config_id_key" ON "dfe_nsu_controles"("config_id");

-- CreateIndex
CREATE INDEX "dfe_nsu_controles_proxima_consulta_em_processamento_idx" ON "dfe_nsu_controles"("proxima_consulta", "em_processamento");

-- CreateIndex
CREATE UNIQUE INDEX "dfe_nsu_controles_tenant_id_cnpj_key" ON "dfe_nsu_controles"("tenant_id", "cnpj");

-- CreateIndex
CREATE INDEX "dfe_lotes_tenant_id_cnpj_status_idx" ON "dfe_lotes"("tenant_id", "cnpj", "status");

-- CreateIndex
CREATE INDEX "dfe_lotes_tenant_id_iniciado_em_idx" ON "dfe_lotes"("tenant_id", "iniciado_em");

-- CreateIndex
CREATE INDEX "dfe_lotes_controle_id_status_idx" ON "dfe_lotes"("controle_id", "status");

-- CreateIndex
CREATE INDEX "dfe_documentos_tenant_id_cnpj_destinatario_idx" ON "dfe_documentos"("tenant_id", "cnpj_destinatario");

-- CreateIndex
CREATE INDEX "dfe_documentos_tenant_id_chave_acesso_idx" ON "dfe_documentos"("tenant_id", "chave_acesso");

-- CreateIndex
CREATE INDEX "dfe_documentos_tenant_id_tipo_documento_idx" ON "dfe_documentos"("tenant_id", "tipo_documento");

-- CreateIndex
CREATE INDEX "dfe_documentos_tenant_id_processado_idx" ON "dfe_documentos"("tenant_id", "processado");

-- CreateIndex
CREATE INDEX "dfe_documentos_tenant_id_nfe_dh_emissao_idx" ON "dfe_documentos"("tenant_id", "nfe_dh_emissao");

-- CreateIndex
CREATE UNIQUE INDEX "dfe_documentos_tenant_id_nsu_key" ON "dfe_documentos"("tenant_id", "nsu");

-- CreateIndex
CREATE INDEX "dfe_auditorias_tenant_id_cnpj_criado_em_idx" ON "dfe_auditorias"("tenant_id", "cnpj", "criado_em");

-- CreateIndex
CREATE INDEX "dfe_auditorias_tenant_id_sucesso_idx" ON "dfe_auditorias"("tenant_id", "sucesso");

-- AddForeignKey
ALTER TABLE "dfe_configs" ADD CONSTRAINT "dfe_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_configs" ADD CONSTRAINT "dfe_configs_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificados_digitais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_configs" ADD CONSTRAINT "dfe_configs_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_nsu_controles" ADD CONSTRAINT "dfe_nsu_controles_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "dfe_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_lotes" ADD CONSTRAINT "dfe_lotes_controle_id_fkey" FOREIGN KEY ("controle_id") REFERENCES "dfe_nsu_controles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_documentos" ADD CONSTRAINT "dfe_documentos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "dfe_lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
