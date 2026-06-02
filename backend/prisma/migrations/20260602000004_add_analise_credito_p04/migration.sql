-- Migration: add_analise_credito_p04
-- Tabelas do pipeline P04 — Alertas e Classificação de Risco
-- Referência: .selene/tasks/p04_alertas.md | Versão prompt: P04-v1

-- ─── credito_alertas ──────────────────────────────────────────────────────────
CREATE TABLE "credito_alertas" (
    "id"           TEXT        NOT NULL,
    "empresa_id"   TEXT        NOT NULL,
    "exercicio"    INTEGER     NOT NULL,
    "codigo_regra" VARCHAR(10) NOT NULL,   -- CR-01 | AT-03 | PO-05
    "severidade"   VARCHAR(10) NOT NULL,   -- critico | atencao | positivo
    "indicador"    VARCHAR(50) NOT NULL,
    "valor_atual"  DECIMAL(18, 6),
    "mensagem"     TEXT        NOT NULL,
    "categoria"    VARCHAR(40) NOT NULL,
    "regra_ok"     INTEGER     NOT NULL DEFAULT 1,

    CONSTRAINT "credito_alertas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_alertas_empresa_id_exercicio_codigo_regra_key"
    ON "credito_alertas"("empresa_id", "exercicio", "codigo_regra");

CREATE INDEX "credito_alertas_empresa_id_exercicio_idx"
    ON "credito_alertas"("empresa_id", "exercicio");

ALTER TABLE "credito_alertas"
    ADD CONSTRAINT "credito_alertas_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_classificacoes ───────────────────────────────────────────────────
CREATE TABLE "credito_classificacoes" (
    "id"                 TEXT        NOT NULL,
    "empresa_id"         TEXT        NOT NULL,
    "exercicio"          INTEGER     NOT NULL,
    "classificacao"      VARCHAR(20) NOT NULL,  -- BAIXO | MEDIO_BAIXO | MEDIO | MEDIO_ALTO | ALTO
    "classificacao_num"  INTEGER     NOT NULL,  -- 1-5
    "qtd_criticos"       INTEGER     NOT NULL,
    "qtd_atencao"        INTEGER     NOT NULL,
    "qtd_positivos"      INTEGER     NOT NULL,
    "override_aplicado"  INTEGER     NOT NULL DEFAULT 0,
    "motivo_override"    TEXT,
    "confiabilidade"     VARCHAR(10) NOT NULL,  -- alta | media | baixa
    "data_geracao"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credito_classificacoes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_classificacoes_empresa_id_exercicio_key"
    ON "credito_classificacoes"("empresa_id", "exercicio");

CREATE INDEX "credito_classificacoes_empresa_id_idx"
    ON "credito_classificacoes"("empresa_id");

ALTER TABLE "credito_classificacoes"
    ADD CONSTRAINT "credito_classificacoes_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
