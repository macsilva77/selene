/*
  Warnings:

  - You are about to drop the column `cert_senha_enc` on the `dfe_configs` table. All the data in the column will be lost.
  - You are about to drop the column `cert_senha_iv` on the `dfe_configs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "certificados_digitais" ADD COLUMN     "cert_pem_enc" BYTEA,
ADD COLUMN     "cert_pem_iv" TEXT,
ADD COLUMN     "key_pem_enc" BYTEA,
ADD COLUMN     "key_pem_iv" TEXT;

-- AlterTable
ALTER TABLE "dfe_configs" DROP COLUMN "cert_senha_enc",
DROP COLUMN "cert_senha_iv";
