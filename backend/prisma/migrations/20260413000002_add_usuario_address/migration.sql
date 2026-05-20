-- Migration: adiciona campos de dados pessoais e endereço ao model Usuario
ALTER TABLE "usuarios"
  ADD COLUMN IF NOT EXISTS "cpf"         TEXT,
  ADD COLUMN IF NOT EXISTS "telefone"    TEXT,
  ADD COLUMN IF NOT EXISTS "cep"         TEXT,
  ADD COLUMN IF NOT EXISTS "logradouro"  TEXT,
  ADD COLUMN IF NOT EXISTS "numero"      TEXT,
  ADD COLUMN IF NOT EXISTS "complemento" TEXT,
  ADD COLUMN IF NOT EXISTS "bairro"      TEXT,
  ADD COLUMN IF NOT EXISTS "municipio"   TEXT,
  ADD COLUMN IF NOT EXISTS "uf"          CHAR(2);
