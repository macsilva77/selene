-- CreateTable
CREATE TABLE "obrigacao_acessoria" (
    "id" TEXT NOT NULL,
    "id_evento" VARCHAR(255) NOT NULL,
    "tipo_obrigacao" VARCHAR(30) NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "inscricao_estadual" VARCHAR(20),
    "data_inicial" DATE NOT NULL,
    "data_final" DATE NOT NULL,
    "finalidade" VARCHAR(20) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "data_entrega" TIMESTAMPTZ(6) NOT NULL,
    "nome_arquivo" VARCHAR(500) NOT NULL,
    "caminho_bucket" VARCHAR(1000) NOT NULL,
    "status_processamento" VARCHAR(50) NOT NULL,
    "origem" VARCHAR(20) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "versao_atual" BOOLEAN NOT NULL DEFAULT true,
    "data_recebimento_evento" TIMESTAMPTZ(6) NOT NULL,
    "obrigacao_pai_id" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,
    "atualizado_por" VARCHAR(255) NOT NULL,

    CONSTRAINT "obrigacao_acessoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: RN-08 idempotência por id_evento
CREATE UNIQUE INDEX "obrigacao_acessoria_id_evento_key" ON "obrigacao_acessoria"("id_evento");

-- CreateIndex: filtros de consulta (cnpj + tipo + período)
CREATE INDEX "obrigacao_acessoria_cnpj_tipo_obrigacao_data_inicial_data_f_idx" ON "obrigacao_acessoria"("cnpj", "tipo_obrigacao", "data_inicial", "data_final");

-- CreateIndex: dashboard de erros
CREATE INDEX "obrigacao_acessoria_status_processamento_idx" ON "obrigacao_acessoria"("status_processamento");

-- CreateIndex: filtros rápidos versão atual
CREATE INDEX "obrigacao_acessoria_versao_atual_idx" ON "obrigacao_acessoria"("versao_atual");

-- AddForeignKey: RN-11 auto-relacionamento para retificações
ALTER TABLE "obrigacao_acessoria" ADD CONSTRAINT "obrigacao_acessoria_obrigacao_pai_id_fkey" FOREIGN KEY ("obrigacao_pai_id") REFERENCES "obrigacao_acessoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
