-- AlterTable: add numero_processo to contratos
ALTER TABLE "contratos" ADD COLUMN "numero_processo" VARCHAR(100);

-- AlterTable: add nome_exibicao to documentos
ALTER TABLE "documentos" ADD COLUMN "nome_exibicao" VARCHAR(255);
