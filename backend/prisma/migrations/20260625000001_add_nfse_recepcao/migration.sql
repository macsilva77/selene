-- Recepção NFS-e (modelo Nacional — SNNFS-e / ADN)
-- Tabelas: nfse_documentos, nfse_eventos, nfse_configs, nfse_nsu_controles

-- CreateEnum
CREATE TYPE "NfsePapelTitular" AS ENUM ('PRESTADOR', 'TOMADOR', 'INTERMEDIARIO');

-- CreateTable
CREATE TABLE "nfse_documentos" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj_titular" TEXT NOT NULL,
    "papel_titular" "NfsePapelTitular" NOT NULL,
    "chave_acesso" VARCHAR(50) NOT NULL,
    "numero" TEXT,
    "amb_gerador" INTEGER,
    "cod_mun_emissor" VARCHAR(7),
    "cod_mun_incidencia" VARCHAR(7),
    "dh_processamento" TIMESTAMP(3),
    "competencia" DATE,
    "prestador_doc" TEXT,
    "prestador_nome" TEXT,
    "prestador_im" TEXT,
    "prestador_op_simp_nac" INTEGER,
    "prestador_reg_esp_trib" INTEGER,
    "tomador_doc" TEXT,
    "tomador_nome" TEXT,
    "intermediario_doc" TEXT,
    "intermediario_nome" TEXT,
    "cod_trib_nac" VARCHAR(6),
    "cod_trib_mun" TEXT,
    "descricao_servico" TEXT,
    "cod_nbs" TEXT,
    "valor_servico" DECIMAL(15,2),
    "valor_bc_issqn" DECIMAL(15,2),
    "aliquota_issqn" DECIMAL(5,2),
    "valor_issqn" DECIMAL(15,2),
    "valor_total_ret" DECIMAL(15,2),
    "valor_liquido" DECIMAL(15,2),
    "trib_issqn" INTEGER,
    "tp_ret_issqn" INTEGER,
    "chave_dps" VARCHAR(45),
    "numero_dps" TEXT,
    "serie_dps" TEXT,
    "xml_original" BYTEA,
    "xml_storage_path" VARCHAR(500),
    "xml_hash" TEXT NOT NULL,
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "processado" BOOLEAN NOT NULL DEFAULT false,
    "processado_em" TIMESTAMP(3),
    "erro_processamento" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfse_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfse_eventos" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "documento_id" TEXT,
    "chave_nfse" VARCHAR(50) NOT NULL,
    "tipo_evento" TEXT NOT NULL,
    "descricao_evento" TEXT,
    "n_seq_evento" INTEGER,
    "amb_gerador" INTEGER,
    "dh_processamento" TIMESTAMP(3),
    "autor_doc" TEXT,
    "motivo_codigo" TEXT,
    "motivo_texto" TEXT,
    "chave_substituta" VARCHAR(50),
    "xml_original" BYTEA,
    "xml_storage_path" VARCHAR(500),
    "xml_hash" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfse_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfse_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "tp_amb" INTEGER NOT NULL DEFAULT 2,
    "base_url" TEXT NOT NULL,
    "certificado_id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "horario_captura" TEXT NOT NULL DEFAULT '00:00',
    "intervalo_minutos" INTEGER NOT NULL DEFAULT 60,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "criado_por_id" TEXT,

    CONSTRAINT "nfse_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfse_nsu_controles" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "ultimo_nsu" TEXT NOT NULL DEFAULT '0',
    "ultima_consulta" TIMESTAMP(3),
    "proxima_consulta" TIMESTAMP(3),
    "em_processamento" BOOLEAN NOT NULL DEFAULT false,
    "lock_id" TEXT,
    "lock_ate" TIMESTAMP(3),
    "lock_processo_id" TEXT,
    "total_doc_baixados" INTEGER NOT NULL DEFAULT 0,
    "total_ciclos" INTEGER NOT NULL DEFAULT 0,
    "total_erros" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "ultimo_erro_em" TIMESTAMP(3),
    "erros_consecutivos" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfse_nsu_controles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nfse_documentos_tenant_id_cnpj_titular_idx" ON "nfse_documentos"("tenant_id", "cnpj_titular");

-- CreateIndex
CREATE INDEX "nfse_documentos_tenant_id_prestador_doc_idx" ON "nfse_documentos"("tenant_id", "prestador_doc");

-- CreateIndex
CREATE INDEX "nfse_documentos_tenant_id_tomador_doc_idx" ON "nfse_documentos"("tenant_id", "tomador_doc");

-- CreateIndex
CREATE INDEX "nfse_documentos_tenant_id_competencia_idx" ON "nfse_documentos"("tenant_id", "competencia");

-- CreateIndex
CREATE INDEX "nfse_documentos_tenant_id_cod_mun_incidencia_idx" ON "nfse_documentos"("tenant_id", "cod_mun_incidencia");

-- CreateIndex
CREATE INDEX "nfse_documentos_tenant_id_processado_idx" ON "nfse_documentos"("tenant_id", "processado");

-- CreateIndex
CREATE UNIQUE INDEX "nfse_documentos_tenant_id_chave_acesso_key" ON "nfse_documentos"("tenant_id", "chave_acesso");

-- CreateIndex
CREATE INDEX "nfse_eventos_tenant_id_chave_nfse_idx" ON "nfse_eventos"("tenant_id", "chave_nfse");

-- CreateIndex
CREATE INDEX "nfse_eventos_tenant_id_tipo_evento_idx" ON "nfse_eventos"("tenant_id", "tipo_evento");

-- CreateIndex
CREATE INDEX "nfse_eventos_documento_id_idx" ON "nfse_eventos"("documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "nfse_eventos_tenant_id_chave_nfse_tipo_evento_n_seq_evento_key" ON "nfse_eventos"("tenant_id", "chave_nfse", "tipo_evento", "n_seq_evento");

-- CreateIndex
CREATE INDEX "nfse_configs_tenant_id_ativo_idx" ON "nfse_configs"("tenant_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "nfse_configs_tenant_id_cnpj_key" ON "nfse_configs"("tenant_id", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "nfse_nsu_controles_config_id_key" ON "nfse_nsu_controles"("config_id");

-- CreateIndex
CREATE INDEX "nfse_nsu_controles_proxima_consulta_em_processamento_idx" ON "nfse_nsu_controles"("proxima_consulta", "em_processamento");

-- CreateIndex
CREATE UNIQUE INDEX "nfse_nsu_controles_tenant_id_cnpj_key" ON "nfse_nsu_controles"("tenant_id", "cnpj");

-- AddForeignKey
ALTER TABLE "nfse_eventos" ADD CONSTRAINT "nfse_eventos_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "nfse_documentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfse_nsu_controles" ADD CONSTRAINT "nfse_nsu_controles_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "nfse_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;