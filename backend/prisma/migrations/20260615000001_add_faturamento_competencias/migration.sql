-- CreateTable: faturamento_competencias
-- Armazena o faturamento mensal extraído do EFD ICMS/IPI (e futuramente EFD Contribuições).
-- Chave única: (tenant_id, empresa_id, ano, mes, fonte) — permite múltiplas fontes por competência.

CREATE TABLE "faturamento_competencias" (
    "id"                    TEXT            NOT NULL,
    "tenant_id"             TEXT            NOT NULL,
    "empresa_id"            TEXT            NOT NULL,
    "cnpj"                  VARCHAR(14)     NOT NULL,
    "ano"                   INTEGER         NOT NULL,
    "mes"                   INTEGER         NOT NULL,
    "fonte"                 VARCHAR(20)     NOT NULL DEFAULT 'EFD_ICMS',
    "vl_faturamento_bruto"  DECIMAL(18,2)   NOT NULL DEFAULT 0,
    "vl_icms"               DECIMAL(18,2)   NOT NULL DEFAULT 0,
    "vl_ipi"                DECIMAL(18,2)   NOT NULL DEFAULT 0,
    "qtd_documentos"        INTEGER         NOT NULL DEFAULT 0,
    "gcs_uri"               TEXT            NOT NULL,
    "hash_arquivo"          VARCHAR(64)     NOT NULL,
    "cfops_json"            TEXT,
    "processado_em"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em"         TIMESTAMP(3)    NOT NULL,

    CONSTRAINT "faturamento_competencias_pkey" PRIMARY KEY ("id")
);

-- UniqueIndex
CREATE UNIQUE INDEX "faturamento_competencias_tenant_id_empresa_id_ano_mes_fonte_key"
    ON "faturamento_competencias"("tenant_id", "empresa_id", "ano", "mes", "fonte");

-- Index para consultas por CNPJ dentro do tenant
CREATE INDEX "faturamento_competencias_tenant_id_cnpj_idx"
    ON "faturamento_competencias"("tenant_id", "cnpj");

-- FK → tenants
ALTER TABLE "faturamento_competencias"
    ADD CONSTRAINT "faturamento_competencias_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
