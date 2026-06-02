-- Migration: add_analise_credito_p03
-- Tabelas do pipeline P03 — Indicadores Financeiros e Estrutura de Capital
-- Referência: .selene/tasks/p03_indicadores.md | Versão prompt: P03-v1

-- ─── credito_indicadores ──────────────────────────────────────────────────────
CREATE TABLE "credito_indicadores" (
    "id"        TEXT        NOT NULL,
    "empresa_id" TEXT       NOT NULL,
    "exercicio" INTEGER     NOT NULL,
    "indicador" VARCHAR(50) NOT NULL,
    "valor"     DECIMAL(18, 6),          -- NULL = SAFE_DIV retornou null
    "unidade"   VARCHAR(15) NOT NULL,    -- ratio | percentual | dias | reais
    "fonte_ok"  INTEGER     NOT NULL DEFAULT 1,

    CONSTRAINT "credito_indicadores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_indicadores_empresa_id_exercicio_indicador_key"
    ON "credito_indicadores"("empresa_id", "exercicio", "indicador");

CREATE INDEX "credito_indicadores_empresa_id_exercicio_idx"
    ON "credito_indicadores"("empresa_id", "exercicio");

ALTER TABLE "credito_indicadores"
    ADD CONSTRAINT "credito_indicadores_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_estrutura_capital ────────────────────────────────────────────────
CREATE TABLE "credito_estrutura_capital" (
    "id"                      TEXT NOT NULL,
    "empresa_id"              TEXT NOT NULL,
    "exercicio"               INTEGER NOT NULL,
    "ativo_total"             DECIMAL(18, 2),
    "passivo_total"           DECIMAL(18, 2),
    "pl"                      DECIMAL(18, 2),
    "divida_financeira_cp"    DECIMAL(18, 2),
    "divida_financeira_lp"    DECIMAL(18, 2),
    "divida_financeira_tot"   DECIMAL(18, 2),
    "divida_liquida"          DECIMAL(18, 2),
    "capital_proprio_pct"     DECIMAL(18, 6),
    "capital_terceiros_pct"   DECIMAL(18, 6),
    "grau_endividamento"      DECIMAL(18, 6),
    "independencia_financeira" DECIMAL(18, 6),
    "relacao_ct_cp"           DECIMAL(18, 6),
    "endiv_bancario_pl"       DECIMAL(18, 6),
    "cobertura_juros"         DECIMAL(18, 6),
    "divida_cp_pct"           DECIMAL(18, 6),

    CONSTRAINT "credito_estrutura_capital_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_estrutura_capital_empresa_id_exercicio_key"
    ON "credito_estrutura_capital"("empresa_id", "exercicio");

CREATE INDEX "credito_estrutura_capital_empresa_id_idx"
    ON "credito_estrutura_capital"("empresa_id");

ALTER TABLE "credito_estrutura_capital"
    ADD CONSTRAINT "credito_estrutura_capital_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
