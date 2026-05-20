-- AlterTable: adicionar campos da planilha de contratos
ALTER TABLE "contratos"
  ADD COLUMN IF NOT EXISTS "termo_aditivo"    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "valor_parcela"    DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "data_assinatura"  DATE,
  ADD COLUMN IF NOT EXISTS "data_publicacao"  DATE,
  ADD COLUMN IF NOT EXISTS "prazo"            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "fiscal_nome"      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "oficio_tceal"     VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "protocolo_tceal"  VARCHAR(100);
