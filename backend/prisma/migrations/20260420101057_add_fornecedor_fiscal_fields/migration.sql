-- AlterTable
ALTER TABLE "fornecedores" ADD COLUMN     "cnae_principal" TEXT,
ADD COLUMN     "inscricao_estadual" TEXT,
ADD COLUMN     "inscricao_municipal" TEXT,
ADD COLUMN     "regime_tributario" TEXT,
ADD COLUMN     "situacao_cadastral" TEXT,
ADD COLUMN     "tipo_estabelecimento" TEXT;
