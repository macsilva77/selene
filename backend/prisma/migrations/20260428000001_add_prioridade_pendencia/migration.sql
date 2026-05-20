-- CreateEnum
CREATE TYPE "PrioridadePendencia" AS ENUM ('baixa', 'media', 'alta', 'critica');

-- AlterTable
ALTER TABLE "pendencias" ADD COLUMN "prioridade" "PrioridadePendencia" NOT NULL DEFAULT 'media';
