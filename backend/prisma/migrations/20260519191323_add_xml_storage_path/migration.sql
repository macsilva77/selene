-- AlterTable
ALTER TABLE "dfe_documentos" ADD COLUMN     "xml_storage_path" VARCHAR(500),
ALTER COLUMN "xml_original" DROP NOT NULL;
