-- AlterTable
ALTER TABLE "dfe_configs" ADD COLUMN     "horario_captura" TEXT NOT NULL DEFAULT '00:00',
ADD COLUMN     "intervalo_minutos" INTEGER NOT NULL DEFAULT 60;
