-- Migration: Simples Nacional + PGDAS
-- Aplicar com: prisma migrate dev --name add_simples_nacional
-- Ou em prod:  prisma db push

CREATE TABLE simples_nacional_situacoes (
  id            TEXT        NOT NULL PRIMARY KEY,
  tenant_id     TEXT        NOT NULL,
  empresa_id    TEXT        NOT NULL UNIQUE,
  cnpj          VARCHAR(14) NOT NULL,
  optante       BOOLEAN     NOT NULL,
  situacao      VARCHAR(20) NOT NULL,
  data_opcao    DATE,
  data_exclusao DATE,
  consultado_em TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT fk_sn_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_sn_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
);

CREATE INDEX idx_sn_tenant_optante ON simples_nacional_situacoes (tenant_id, optante);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE pgdas_declaracoes (
  id                   TEXT         NOT NULL PRIMARY KEY,
  tenant_id            TEXT         NOT NULL,
  empresa_id           TEXT         NOT NULL,
  cnpj                 VARCHAR(14)  NOT NULL,
  periodo              VARCHAR(7)   NOT NULL,            -- AAAA-MM
  vl_receita_bruta     DECIMAL(18,2) NOT NULL DEFAULT 0,
  vl_receita_comercio  DECIMAL(18,2) NOT NULL DEFAULT 0,
  vl_receita_industria DECIMAL(18,2) NOT NULL DEFAULT 0,
  vl_receita_servicos  DECIMAL(18,2) NOT NULL DEFAULT 0,
  vl_das               DECIMAL(18,2),
  situacao_declaracao  VARCHAR(30)  NOT NULL DEFAULT 'TRANSMITIDA',
  coletado_em          TIMESTAMP(3) NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMP(3) NOT NULL DEFAULT now(),

  CONSTRAINT fk_pgdas_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_pgdas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT uq_pgdas_periodo UNIQUE (tenant_id, empresa_id, periodo)
);

CREATE INDEX idx_pgdas_tenant_empresa ON pgdas_declaracoes (tenant_id, empresa_id);
