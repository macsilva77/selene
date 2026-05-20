-- CreateEnum
CREATE TYPE "ContratoSubtipo" AS ENUM ('manutencao_predial', 'conservacao', 'utilidades', 'software', 'infraestrutura', 'hardware', 'consultoria', 'rh');

-- AlterTable
ALTER TABLE "contratos" ADD COLUMN     "subtipo" "ContratoSubtipo";

-- AlterTable
ALTER TABLE "empresas" ALTER COLUMN "criado_em" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "atualizado_em" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "diretor_designado_em" SET DATA TYPE TIMESTAMP(3);
