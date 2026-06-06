#!/bin/sh
set -e

# Grava o SQL de fix em arquivo temporário para evitar problemas de quoting
cat > /tmp/fix_migration.sql << 'ENDSQL'
DELETE FROM _prisma_migrations WHERE migration_name = '20260605000001_add_ecf_trimestre' AND finished_at IS NULL;
ENDSQL

# Tenta corrigir o estado da migration falha antes de rodar o deploy
npx prisma db execute --url "$DATABASE_URL" --file /tmp/fix_migration.sql 2>/dev/null || true
rm -f /tmp/fix_migration.sql

# Aplica todas as migrations pendentes (inclusive a corrigida)
npx prisma migrate deploy

# Inicia a aplicação
exec node dist/src/main
