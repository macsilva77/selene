/*
  Warnings:

  - You are about to drop the column `storage_key` on the `certificados_digitais` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "certificados_digitais" DROP COLUMN "storage_key",
ADD COLUMN     "arquivo_enc" BYTEA;
