CREATE TABLE "empresas" (
  "id"                   TEXT        NOT NULL,
  "tenant_id"            TEXT        NOT NULL,
  "nome"                 TEXT        NOT NULL,
  "nome_fantasia"        TEXT,
  "cnpj"                 TEXT        NOT NULL,
  "email"                TEXT,
  "telefone"             TEXT,
  "cep"                  VARCHAR(10),
  "logradouro"           TEXT,
  "numero"               VARCHAR(20),
  "complemento"          TEXT,
  "bairro"               TEXT,
  "municipio"            TEXT,
  "uf"                   VARCHAR(2),
  "cnae_principal"       TEXT,
  "inscricao_estadual"   TEXT,
  "inscricao_municipal"  TEXT,
  "regime_tributario"    TEXT,
  "situacao_cadastral"   TEXT,
  "tipo_estabelecimento" TEXT,
  "ativo"                BOOLEAN     NOT NULL DEFAULT true,
  "criado_em"            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em"        TIMESTAMPTZ NOT NULL,

  CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "empresas" ADD CONSTRAINT "empresas_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "empresas_tenant_id_cnpj_key" ON "empresas"("tenant_id", "cnpj");
