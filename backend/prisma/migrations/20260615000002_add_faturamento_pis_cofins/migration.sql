-- AlterTable: adiciona colunas vl_pis e vl_cofins a faturamento_competencias
-- Necessário para armazenar PIS e COFINS apurados via EFD Contribuições (Fase 2).
-- Valores padrão 0 garantem compatibilidade retroativa com registros EFD_ICMS existentes.

ALTER TABLE "faturamento_competencias"
    ADD COLUMN "vl_pis"     DECIMAL(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN "vl_cofins"  DECIMAL(18,2) NOT NULL DEFAULT 0;
