-- AlterTable: torna senhaHash opcional e adiciona campos de reset de senha
ALTER TABLE "usuarios"
  ALTER COLUMN "senha_hash" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "reset_token"        TEXT,
  ADD COLUMN IF NOT EXISTS "reset_token_expiry"  TIMESTAMP(3);
