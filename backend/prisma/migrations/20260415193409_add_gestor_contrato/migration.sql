-- AlterTable
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "gestor_id" TEXT;

-- AddForeignKey (apenas se a constraint ainda não existir)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contratos_gestor_id_fkey'
  ) THEN
    ALTER TABLE "contratos" ADD CONSTRAINT "contratos_gestor_id_fkey"
      FOREIGN KEY ("gestor_id") REFERENCES "usuarios"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
