-- AlterEnum
ALTER TYPE "PendenciaStatus" ADD VALUE 'em_andamento';

-- AlterTable
ALTER TABLE "pendencias" ADD COLUMN     "data_inicio" DATE;
