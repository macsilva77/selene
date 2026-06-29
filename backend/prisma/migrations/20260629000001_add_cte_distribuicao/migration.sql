-- CreateEnum
CREATE TYPE "CteLoteStatus" AS ENUM ('RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'ERRO', 'REPROCESSAR');

-- CreateEnum
CREATE TYPE "CteTipoDocumento" AS ENUM ('PROC_CTE', 'PROC_EVENTO_CTE', 'RES_CTE', 'RES_EVENTO_CTE');

-- CreateEnum
CREATE TYPE "CteGapStatus" AS ENUM ('PENDENTE', 'RECUPERADO', 'INEXISTENTE', 'ESGOTADO');

-- CreateEnum
CREATE TYPE "CteVarreduraStatus" AS ENUM ('ATIVA', 'PAUSADA', 'CONCLUIDA', 'ERRO');

-- CreateEnum
CREATE TYPE "CteEventoStatus" AS ENUM ('PENDENTE', 'ENVIADO', 'REJEITADO', 'ERRO');

-- CreateTable
CREATE TABLE "cte_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "c_uf" INTEGER NOT NULL,
    "tp_amb" INTEGER NOT NULL DEFAULT 1,
    "certificado_id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "horario_captura" TEXT NOT NULL DEFAULT '00:00',
    "intervalo_minutos" INTEGER NOT NULL DEFAULT 60,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "criado_por_id" TEXT NOT NULL,

    CONSTRAINT "cte_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_nsu_controles" (
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

    CONSTRAINT "cte_nsu_controles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_lotes" (
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
    "status" "CteLoteStatus" NOT NULL DEFAULT 'RECEBIDO',
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "duracao_ms" INTEGER,
    "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizado_em" TIMESTAMP(3),
    "erro_mensagem" TEXT,

    CONSTRAINT "cte_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_documentos" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj_interessado" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "tipo_documento" "CteTipoDocumento" NOT NULL,
    "modelo" INTEGER,
    "xml_original" BYTEA,
    "xml_storage_path" VARCHAR(500),
    "xml_hash" TEXT NOT NULL,
    "chave_acesso" TEXT,
    "cte_emitente_cnpj" TEXT,
    "cte_emitente_nome" TEXT,
    "cte_valor_prestacao" DECIMAL(15,2),
    "cte_valor_receber" DECIMAL(15,2),
    "cte_dh_emissao" TIMESTAMP(3),
    "cte_situacao" TEXT,
    "tp_cte" INTEGER,
    "cfop" TEXT,
    "modal" TEXT,
    "uf_ini" TEXT,
    "uf_fim" TEXT,
    "cte_tomador_cnpj" TEXT,
    "cte_remetente_cnpj" TEXT,
    "cte_destinatario_cnpj" TEXT,
    "cte_expedidor_cnpj" TEXT,
    "cte_recebedor_cnpj" TEXT,
    "cte_chaves_nfe" TEXT,
    "evento_tipo" TEXT,
    "evento_descricao" TEXT,
    "processado" BOOLEAN NOT NULL DEFAULT false,
    "processado_em" TIMESTAMP(3),
    "erro_processamento" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cte_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_auditorias" (
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

    CONSTRAINT "cte_auditorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_gap_nsus" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "nsu_faltante" TEXT NOT NULL,
    "status" "CteGapStatus" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "nsu_anterior" TEXT NOT NULL,
    "nsu_posterior" TEXT NOT NULL,
    "proxima_tentativa" TIMESTAMP(3),
    "recuperado_em" TIMESTAMP(3),
    "documento_id" TEXT,
    "erro_mensagem" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cte_gap_nsus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_varreduras_nsu" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "status" "CteVarreduraStatus" NOT NULL DEFAULT 'PAUSADA',
    "nsu_inicio" TEXT NOT NULL,
    "nsu_fim" TEXT NOT NULL,
    "nsu_atual" TEXT NOT NULL,
    "total_consultado" INTEGER NOT NULL DEFAULT 0,
    "total_recuperado" INTEGER NOT NULL DEFAULT 0,
    "iniciado_em" TIMESTAMP(3),
    "pausado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "ultimo_erro" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cte_varreduras_nsu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_eventos" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "chave_acesso" VARCHAR(44) NOT NULL,
    "tp_evento" VARCHAR(6) NOT NULL,
    "x_evento" VARCHAR(60) NOT NULL,
    "n_seq_evento" INTEGER NOT NULL DEFAULT 1,
    "x_obs" VARCHAR(255),
    "ind_desacordo" BOOLEAN NOT NULL DEFAULT true,
    "uf_autorizador" TEXT,
    "status" "CteEventoStatus" NOT NULL DEFAULT 'PENDENTE',
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

    CONSTRAINT "cte_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_documento_etiquetas" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "etiqueta_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cte_documento_etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cte_etiqueta_historico" (
    "id" TEXT NOT NULL,
    "documento_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "etiquetas_antes" JSONB NOT NULL,
    "etiquetas_depois" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cte_etiqueta_historico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cte_configs_tenant_id_ativo_idx" ON "cte_configs"("tenant_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "cte_configs_tenant_id_cnpj_key" ON "cte_configs"("tenant_id", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "cte_nsu_controles_config_id_key" ON "cte_nsu_controles"("config_id");

-- CreateIndex
CREATE INDEX "cte_nsu_controles_proxima_consulta_em_processamento_idx" ON "cte_nsu_controles"("proxima_consulta", "em_processamento");

-- CreateIndex
CREATE UNIQUE INDEX "cte_nsu_controles_tenant_id_cnpj_key" ON "cte_nsu_controles"("tenant_id", "cnpj");

-- CreateIndex
CREATE INDEX "cte_lotes_tenant_id_cnpj_status_idx" ON "cte_lotes"("tenant_id", "cnpj", "status");

-- CreateIndex
CREATE INDEX "cte_lotes_tenant_id_iniciado_em_idx" ON "cte_lotes"("tenant_id", "iniciado_em");

-- CreateIndex
CREATE INDEX "cte_lotes_controle_id_status_idx" ON "cte_lotes"("controle_id", "status");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_cnpj_interessado_idx" ON "cte_documentos"("tenant_id", "cnpj_interessado");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_cte_tomador_cnpj_idx" ON "cte_documentos"("tenant_id", "cte_tomador_cnpj");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_cte_remetente_cnpj_idx" ON "cte_documentos"("tenant_id", "cte_remetente_cnpj");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_cte_destinatario_cnpj_idx" ON "cte_documentos"("tenant_id", "cte_destinatario_cnpj");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_chave_acesso_idx" ON "cte_documentos"("tenant_id", "chave_acesso");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_tipo_documento_idx" ON "cte_documentos"("tenant_id", "tipo_documento");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_modelo_idx" ON "cte_documentos"("tenant_id", "modelo");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_processado_idx" ON "cte_documentos"("tenant_id", "processado");

-- CreateIndex
CREATE INDEX "cte_documentos_tenant_id_cte_dh_emissao_idx" ON "cte_documentos"("tenant_id", "cte_dh_emissao");

-- CreateIndex
CREATE UNIQUE INDEX "cte_documentos_tenant_id_nsu_key" ON "cte_documentos"("tenant_id", "nsu");

-- CreateIndex
CREATE INDEX "cte_auditorias_tenant_id_cnpj_criado_em_idx" ON "cte_auditorias"("tenant_id", "cnpj", "criado_em");

-- CreateIndex
CREATE INDEX "cte_auditorias_tenant_id_sucesso_idx" ON "cte_auditorias"("tenant_id", "sucesso");

-- CreateIndex
CREATE INDEX "cte_gap_nsus_tenant_id_cnpj_status_idx" ON "cte_gap_nsus"("tenant_id", "cnpj", "status");

-- CreateIndex
CREATE INDEX "cte_gap_nsus_status_proxima_tentativa_idx" ON "cte_gap_nsus"("status", "proxima_tentativa");

-- CreateIndex
CREATE INDEX "cte_gap_nsus_config_id_status_idx" ON "cte_gap_nsus"("config_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cte_gap_nsus_tenant_id_cnpj_nsu_faltante_key" ON "cte_gap_nsus"("tenant_id", "cnpj", "nsu_faltante");

-- CreateIndex
CREATE UNIQUE INDEX "cte_varreduras_nsu_config_id_key" ON "cte_varreduras_nsu"("config_id");

-- CreateIndex
CREATE INDEX "cte_varreduras_nsu_tenant_id_status_idx" ON "cte_varreduras_nsu"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "cte_eventos_tenant_id_cnpj_status_idx" ON "cte_eventos"("tenant_id", "cnpj", "status");

-- CreateIndex
CREATE INDEX "cte_eventos_tenant_id_chave_acesso_idx" ON "cte_eventos"("tenant_id", "chave_acesso");

-- CreateIndex
CREATE INDEX "cte_eventos_status_criado_em_idx" ON "cte_eventos"("status", "criado_em");

-- CreateIndex
CREATE INDEX "cte_eventos_documento_id_idx" ON "cte_eventos"("documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "cte_eventos_tenant_id_chave_acesso_tp_evento_n_seq_evento_key" ON "cte_eventos"("tenant_id", "chave_acesso", "tp_evento", "n_seq_evento");

-- CreateIndex
CREATE INDEX "cte_documento_etiquetas_etiqueta_id_idx" ON "cte_documento_etiquetas"("etiqueta_id");

-- CreateIndex
CREATE UNIQUE INDEX "cte_documento_etiquetas_documento_id_etiqueta_id_key" ON "cte_documento_etiquetas"("documento_id", "etiqueta_id");

-- CreateIndex
CREATE INDEX "cte_etiqueta_historico_documento_id_criado_em_idx" ON "cte_etiqueta_historico"("documento_id", "criado_em");

-- AddForeignKey
ALTER TABLE "cte_configs" ADD CONSTRAINT "cte_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_configs" ADD CONSTRAINT "cte_configs_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificados_digitais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_configs" ADD CONSTRAINT "cte_configs_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_nsu_controles" ADD CONSTRAINT "cte_nsu_controles_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "cte_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_lotes" ADD CONSTRAINT "cte_lotes_controle_id_fkey" FOREIGN KEY ("controle_id") REFERENCES "cte_nsu_controles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_documentos" ADD CONSTRAINT "cte_documentos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "cte_lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_gap_nsus" ADD CONSTRAINT "cte_gap_nsus_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "cte_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_gap_nsus" ADD CONSTRAINT "cte_gap_nsus_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "cte_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_varreduras_nsu" ADD CONSTRAINT "cte_varreduras_nsu_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "cte_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_eventos" ADD CONSTRAINT "cte_eventos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "cte_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_documento_etiquetas" ADD CONSTRAINT "cte_documento_etiquetas_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "cte_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_documento_etiquetas" ADD CONSTRAINT "cte_documento_etiquetas_etiqueta_id_fkey" FOREIGN KEY ("etiqueta_id") REFERENCES "etiquetas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_etiqueta_historico" ADD CONSTRAINT "cte_etiqueta_historico_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "cte_documentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cte_etiqueta_historico" ADD CONSTRAINT "cte_etiqueta_historico_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

