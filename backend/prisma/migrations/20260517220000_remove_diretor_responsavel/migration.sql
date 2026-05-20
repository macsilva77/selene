-- AlterTable: remove campos do Diretor Responsável (CMN 4.968/2021 — não implementado no frontend)
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "diretor_nome",
                      DROP COLUMN IF EXISTS "diretor_cargo",
                      DROP COLUMN IF EXISTS "diretor_email",
                      DROP COLUMN IF EXISTS "diretor_designado_em";
