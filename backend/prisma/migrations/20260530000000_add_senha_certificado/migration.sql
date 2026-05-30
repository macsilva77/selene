-- AlterTable
ALTER TABLE "certificados_digitais"
  ADD COLUMN "senha_enc" BYTEA,
  ADD COLUMN "senha_iv"  TEXT;
