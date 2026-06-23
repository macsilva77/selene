-- AlterTable: marca o instante da última troca de senha (revogação de sessões)
ALTER TABLE "usuarios"
  ADD COLUMN IF NOT EXISTS "senha_alterada_em" TIMESTAMP(3);
