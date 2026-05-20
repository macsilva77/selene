-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "diretor_nome" TEXT,
                      ADD COLUMN "diretor_cargo" TEXT,
                      ADD COLUMN "diretor_email" TEXT,
                      ADD COLUMN "diretor_designado_em" TIMESTAMPTZ;
