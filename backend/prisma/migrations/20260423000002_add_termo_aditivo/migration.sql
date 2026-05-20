-- CreateEnum
CREATE TYPE "TipoAditivo" AS ENUM ('PRAZO', 'VALOR_ACRESCIMO', 'VALOR_SUPRESSAO', 'OBJETO', 'REAJUSTE', 'APOSTILAMENTO', 'MISTO');

-- CreateTable
CREATE TABLE "termos_aditivos" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "numero" VARCHAR(100) NOT NULL,
    "tipo" "TipoAditivo" NOT NULL,
    "data_assinatura" DATE NOT NULL,
    "data_publicacao" DATE,
    "vigencia_anterior" DATE,
    "nova_vigencia" DATE,
    "valor_anterior" DECIMAL(15,2),
    "novo_valor" DECIMAL(15,2),
    "percentual_reajuste" DECIMAL(5,2),
    "objeto_aditivo" TEXT,
    "justificativa" TEXT NOT NULL,
    "fundamento_legal" VARCHAR(500),
    "publicacao_link" VARCHAR(500),
    "criado_por" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "termos_aditivos_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "termos_aditivos" ADD CONSTRAINT "termos_aditivos_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
