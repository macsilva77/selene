-- CreateTable
CREATE TABLE "cf_competencias" (
    "id"                      TEXT         NOT NULL,
    "tenant_id"               TEXT         NOT NULL,
    "empresa_id"              TEXT         NOT NULL,
    "cnpj"                    VARCHAR(14)  NOT NULL,
    "ano"                     INTEGER      NOT NULL,
    "mes"                     INTEGER      NOT NULL,
    "sped_gcs_uri"            TEXT         NOT NULL,
    "parquet_path_cliente"    TEXT,
    "parquet_path_fornecedor" TEXT,
    "qtd_clientes"            INTEGER      NOT NULL DEFAULT 0,
    "qtd_fornecedores"        INTEGER      NOT NULL DEFAULT 0,
    "status"                  VARCHAR(20)  NOT NULL DEFAULT 'PROCESSADO',
    "processado_em"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cf_competencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cf_competencias_tenant_id_empresa_id_ano_mes_key"
    ON "cf_competencias"("tenant_id", "empresa_id", "ano", "mes");

-- CreateIndex
CREATE INDEX "cf_competencias_tenant_id_empresa_id_idx"
    ON "cf_competencias"("tenant_id", "empresa_id");

-- AddForeignKey
ALTER TABLE "cf_competencias"
    ADD CONSTRAINT "cf_competencias_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
