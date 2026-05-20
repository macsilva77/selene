-- AlterTable
ALTER TABLE "iniciativas" ADD COLUMN     "origem" "PendenciaOrigem";

-- AlterTable
ALTER TABLE "perfis" ALTER COLUMN "atualizado_em" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "atualizado_em" DROP DEFAULT;

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "uf" SET DATA TYPE TEXT;
