-- Migration: add_analise_credito_p01
-- Tabelas do pipeline P01 — Extração e Normalização ECD/ECF
-- Referência: .selene/tasks/p01_extracao.md | Versão prompt: P01-v1

-- ─── credito_empresas ─────────────────────────────────────────────────────────
CREATE TABLE "credito_empresas" (
    "id"               TEXT NOT NULL,
    "tenant_id"        TEXT NOT NULL,
    "cnpj"             VARCHAR(14) NOT NULL,
    "razao_social"     TEXT NOT NULL,
    "regime_tributario" VARCHAR(30),
    "cnae_principal"   VARCHAR(10),
    "status_extracao"  VARCHAR(20) NOT NULL DEFAULT 'completo',
    "observacoes"      TEXT,
    "criado_em"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credito_empresas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_empresas_tenant_id_cnpj_key"
    ON "credito_empresas"("tenant_id", "cnpj");

CREATE INDEX "credito_empresas_tenant_id_idx"
    ON "credito_empresas"("tenant_id");

ALTER TABLE "credito_empresas"
    ADD CONSTRAINT "credito_empresas_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_plano_contas ─────────────────────────────────────────────────────
CREATE TABLE "credito_plano_contas" (
    "id"           TEXT NOT NULL,
    "empresa_id"   TEXT NOT NULL,
    "exercicio"    INTEGER NOT NULL,
    "conta_codigo" VARCHAR(30) NOT NULL,
    "conta_nome"   TEXT NOT NULL,
    "nivel"        INTEGER NOT NULL,
    "natureza"     VARCHAR(1) NOT NULL,
    "tipo"         VARCHAR(20) NOT NULL,
    "grupo"        VARCHAR(10) NOT NULL,

    CONSTRAINT "credito_plano_contas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_plano_contas_empresa_id_exercicio_conta_codigo_key"
    ON "credito_plano_contas"("empresa_id", "exercicio", "conta_codigo");

CREATE INDEX "credito_plano_contas_empresa_id_exercicio_idx"
    ON "credito_plano_contas"("empresa_id", "exercicio");

ALTER TABLE "credito_plano_contas"
    ADD CONSTRAINT "credito_plano_contas_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_ecd_saldos ───────────────────────────────────────────────────────
CREATE TABLE "credito_ecd_saldos" (
    "id"            TEXT NOT NULL,
    "empresa_id"    TEXT NOT NULL,
    "exercicio"     INTEGER NOT NULL,
    "periodo"       VARCHAR(7) NOT NULL,
    "conta_codigo"  VARCHAR(30) NOT NULL,
    "conta_nome"    TEXT NOT NULL,
    "grupo"         VARCHAR(10),
    "saldo_anterior" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "debitos"       DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditos"      DECIMAL(18,2) NOT NULL DEFAULT 0,
    "saldo_final"   DECIMAL(18,2) NOT NULL DEFAULT 0,
    "natureza_saldo" VARCHAR(1),
    "status"        VARCHAR(20) NOT NULL DEFAULT 'ok',

    CONSTRAINT "credito_ecd_saldos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_ecd_saldos_empresa_id_exercicio_periodo_conta_codigo_key"
    ON "credito_ecd_saldos"("empresa_id", "exercicio", "periodo", "conta_codigo");

CREATE INDEX "credito_ecd_saldos_empresa_id_exercicio_idx"
    ON "credito_ecd_saldos"("empresa_id", "exercicio");

ALTER TABLE "credito_ecd_saldos"
    ADD CONSTRAINT "credito_ecd_saldos_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_ecf_registros ────────────────────────────────────────────────────
CREATE TABLE "credito_ecf_registros" (
    "id"           TEXT NOT NULL,
    "empresa_id"   TEXT NOT NULL,
    "exercicio"    INTEGER NOT NULL,
    "registro_ecf" VARCHAR(10) NOT NULL,
    "linha_codigo" VARCHAR(50) NOT NULL,
    "descricao"    TEXT NOT NULL,
    "valor"        DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status"       VARCHAR(20) NOT NULL DEFAULT 'ok',

    CONSTRAINT "credito_ecf_registros_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_ecf_registros_empresa_id_exercicio_registro_ecf_linha_key"
    ON "credito_ecf_registros"("empresa_id", "exercicio", "registro_ecf", "linha_codigo");

CREATE INDEX "credito_ecf_registros_empresa_id_exercicio_idx"
    ON "credito_ecf_registros"("empresa_id", "exercicio");

ALTER TABLE "credito_ecf_registros"
    ADD CONSTRAINT "credito_ecf_registros_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_inconsistencias ──────────────────────────────────────────────────
CREATE TABLE "credito_inconsistencias" (
    "id"         TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "exercicio"  INTEGER NOT NULL,
    "tipo_erro"  VARCHAR(50) NOT NULL,
    "descricao"  TEXT NOT NULL,
    "severidade" VARCHAR(20) NOT NULL DEFAULT 'alerta',
    "criado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credito_inconsistencias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credito_inconsistencias_empresa_id_exercicio_idx"
    ON "credito_inconsistencias"("empresa_id", "exercicio");

ALTER TABLE "credito_inconsistencias"
    ADD CONSTRAINT "credito_inconsistencias_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_processamentos ───────────────────────────────────────────────────
CREATE TABLE "credito_processamentos" (
    "id"                     TEXT NOT NULL,
    "empresa_id"             TEXT NOT NULL,
    "exercicio"              INTEGER NOT NULL,
    "tabela_destino"         VARCHAR(50) NOT NULL,
    "total_registros"        INTEGER NOT NULL DEFAULT 0,
    "registros_ok"           INTEGER NOT NULL DEFAULT 0,
    "registros_com_alerta"   INTEGER NOT NULL DEFAULT 0,
    "registros_bloqueados"   INTEGER NOT NULL DEFAULT 0,
    "hash_arquivo_origem"    VARCHAR(64),
    "timestamp_processamento" TIMESTAMP(3) NOT NULL,
    "versao_prompt"          VARCHAR(20) NOT NULL DEFAULT 'P01-v1',
    "duracao_ms"             INTEGER,

    CONSTRAINT "credito_processamentos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_processamentos_empresa_id_exercicio_tabela_versao_key"
    ON "credito_processamentos"("empresa_id", "exercicio", "tabela_destino", "versao_prompt");

CREATE INDEX "credito_processamentos_empresa_id_exercicio_idx"
    ON "credito_processamentos"("empresa_id", "exercicio");

ALTER TABLE "credito_processamentos"
    ADD CONSTRAINT "credito_processamentos_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
