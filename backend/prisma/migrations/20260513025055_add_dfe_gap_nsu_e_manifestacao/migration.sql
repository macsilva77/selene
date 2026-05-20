-- CreateEnum
CREATE TYPE "DfeGapStatus" AS ENUM ('PENDENTE', 'RECUPERADO', 'INEXISTENTE', 'ESGOTADO');

-- CreateEnum
CREATE TYPE "DfeManifestacaoStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'REJEITADO', 'ERRO');

-- CreateTable
CREATE TABLE "dfe_gap_nsus" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "nsu_faltante" TEXT NOT NULL,
    "status" "DfeGapStatus" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "nsu_anterior" TEXT NOT NULL,
    "nsu_posterior" TEXT NOT NULL,
    "proxima_tentativa" TIMESTAMP(3),
    "recuperado_em" TIMESTAMP(3),
    "documento_id" TEXT,
    "erro_mensagem" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dfe_gap_nsus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dfe_manifestacoes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "chave_acesso" VARCHAR(44) NOT NULL,
    "tp_evento" VARCHAR(6) NOT NULL,
    "x_evento" VARCHAR(60) NOT NULL,
    "n_seq_evento" INTEGER NOT NULL DEFAULT 1,
    "x_just" VARCHAR(255),
    "status" "DfeManifestacaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "n_prot" VARCHAR(15),
    "c_stat" VARCHAR(3),
    "x_motivo" VARCHAR(255),
    "dh_reg_evento" TIMESTAMP(3),
    "xml_envio" BYTEA,
    "xml_resposta" BYTEA,
    "erro_mensagem" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_em" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dfe_manifestacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dfe_gap_nsus_tenant_id_cnpj_status_idx" ON "dfe_gap_nsus"("tenant_id", "cnpj", "status");

-- CreateIndex
CREATE INDEX "dfe_gap_nsus_status_proxima_tentativa_idx" ON "dfe_gap_nsus"("status", "proxima_tentativa");

-- CreateIndex
CREATE INDEX "dfe_gap_nsus_config_id_status_idx" ON "dfe_gap_nsus"("config_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dfe_gap_nsus_tenant_id_nsu_faltante_key" ON "dfe_gap_nsus"("tenant_id", "nsu_faltante");

-- CreateIndex
CREATE INDEX "dfe_manifestacoes_tenant_id_cnpj_status_idx" ON "dfe_manifestacoes"("tenant_id", "cnpj", "status");

-- CreateIndex
CREATE INDEX "dfe_manifestacoes_tenant_id_chave_acesso_idx" ON "dfe_manifestacoes"("tenant_id", "chave_acesso");

-- CreateIndex
CREATE INDEX "dfe_manifestacoes_status_criado_em_idx" ON "dfe_manifestacoes"("status", "criado_em");

-- CreateIndex
CREATE INDEX "dfe_manifestacoes_documento_id_idx" ON "dfe_manifestacoes"("documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "dfe_manifestacoes_tenant_id_chave_acesso_tp_evento_n_seq_ev_key" ON "dfe_manifestacoes"("tenant_id", "chave_acesso", "tp_evento", "n_seq_evento");

-- AddForeignKey
ALTER TABLE "dfe_gap_nsus" ADD CONSTRAINT "dfe_gap_nsus_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "dfe_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_gap_nsus" ADD CONSTRAINT "dfe_gap_nsus_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "dfe_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dfe_manifestacoes" ADD CONSTRAINT "dfe_manifestacoes_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "dfe_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
