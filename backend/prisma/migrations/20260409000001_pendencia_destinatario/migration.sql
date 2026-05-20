-- AddColumn: destinatario_id em pendencias
-- Armazena o destinatario original (quem deve responder) de forma imutável.
-- Permite que responsavel_id mude de volta ao destinatário quando a pendência
-- for devolvida após ser respondida.

ALTER TABLE "pendencias" ADD COLUMN "destinatario_id" TEXT;

-- Backfill: para registros existentes, destinatario = responsavel atual
UPDATE "pendencias" SET "destinatario_id" = "responsavel_id" WHERE "destinatario_id" IS NULL;

-- Torna NOT NULL após o backfill
ALTER TABLE "pendencias" ALTER COLUMN "destinatario_id" SET NOT NULL;

-- FK para usuarios
ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_destinatario_id_fkey"
  FOREIGN KEY ("destinatario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
