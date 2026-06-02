-- Migration: add_analise_credito_p02
-- Tabelas do pipeline P02 — Balanço Patrimonial e DRE
-- Referência: .selene/tasks/p02_demonstracoes.md | Versão prompt: P02-v1

-- ─── credito_balanco ──────────────────────────────────────────────────────────
CREATE TABLE "credito_balanco" (
    "id"           TEXT NOT NULL,
    "empresa_id"   TEXT NOT NULL,
    "exercicio"    INTEGER NOT NULL,
    "grupo"        VARCHAR(10) NOT NULL,
    "subgrupo"     VARCHAR(60) NOT NULL,
    "conta_codigo" VARCHAR(30) NOT NULL,
    "conta_nome"   TEXT NOT NULL,
    "valor"        DECIMAL(18,2) NOT NULL,
    "fonte"        VARCHAR(20) NOT NULL DEFAULT 'ecd_j100',

    CONSTRAINT "credito_balanco_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_balanco_empresa_id_exercicio_conta_codigo_key"
    ON "credito_balanco"("empresa_id", "exercicio", "conta_codigo");

CREATE INDEX "credito_balanco_empresa_id_exercicio_idx"
    ON "credito_balanco"("empresa_id", "exercicio");

ALTER TABLE "credito_balanco"
    ADD CONSTRAINT "credito_balanco_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── credito_dre ─────────────────────────────────────────────────────────────
CREATE TABLE "credito_dre" (
    "id"        TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "exercicio" INTEGER NOT NULL,
    "linha_dre" VARCHAR(30) NOT NULL,
    "valor"     DECIMAL(18,2) NOT NULL,
    "fonte"     VARCHAR(20) NOT NULL DEFAULT 'ecf_l300',

    CONSTRAINT "credito_dre_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credito_dre_empresa_id_exercicio_linha_dre_key"
    ON "credito_dre"("empresa_id", "exercicio", "linha_dre");

CREATE INDEX "credito_dre_empresa_id_exercicio_idx"
    ON "credito_dre"("empresa_id", "exercicio");

ALTER TABLE "credito_dre"
    ADD CONSTRAINT "credito_dre_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "credito_empresas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
