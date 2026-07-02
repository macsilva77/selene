-- AlterTable: cadeia de certificação (folha + intermediários ICP-Brasil) em PEM, criptografada.
-- Necessária para o mTLS ESTRITO do ADN NFS-e — enviar só a folha causa E2214 (Erro Cadeia de Certificação).
ALTER TABLE "certificados_digitais"
  ADD COLUMN "cert_chain_pem_enc" BYTEA,
  ADD COLUMN "cert_chain_pem_iv" TEXT;
