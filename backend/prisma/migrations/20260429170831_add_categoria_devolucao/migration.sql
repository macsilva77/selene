-- CreateEnum
CREATE TYPE "CategoriaDevolucao" AS ENUM ('resposta_insuficiente', 'documentacao_faltante', 'informacao_incorreta', 'nao_atende_requisito', 'pendente_complementacao', 'outro');

-- AlterTable
ALTER TABLE "pendencias" ADD COLUMN     "categoria_devolucao" "CategoriaDevolucao";
