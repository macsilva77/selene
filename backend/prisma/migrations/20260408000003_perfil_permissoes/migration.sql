-- Migration: Add permissoes (string array) to Perfil
ALTER TABLE "perfis" ADD COLUMN IF NOT EXISTS "permissoes" TEXT[] NOT NULL DEFAULT '{}';
