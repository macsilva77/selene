#!/bin/sh
set -e

MIGRATION="20260605000001_add_ecf_trimestre"

# Se houver uma migration com falha registrada, marca como rolled-back via SQL direto
# para que o prisma migrate deploy possa re-executá-la com o SQL corrigido.
printf 'UPDATE "_prisma_migrations" SET rolled_back_at = NOW() WHERE migration_name = '"'"'%s'"'"' AND finished_at IS NULL;\n' "$MIGRATION" \
  | npx prisma db execute --url "$DATABASE_URL" --stdin 2>/dev/null || true

# Aplica todas as migrations pendentes (inclusive a corrigida acima)
npx prisma migrate deploy

# Inicia a aplicação
exec node dist/src/main
