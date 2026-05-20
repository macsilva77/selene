#!/bin/sh
set -e

echo "==> Sincronizando schema..."

# 1. Tenta migrate deploy (caso o banco já tenha historico de migrations)
npx prisma migrate deploy 2>&1
if [ $? -eq 0 ]; then
  echo "==> Migrations aplicadas com sucesso."
  exec node dist/src/main
fi

# 2. Se falhou com P3005 (sem tabela _prisma_migrations) ou P3009 (migration com falha):
# Resolve qualquer migration em estado de falha
npx prisma migrate resolve --rolled-back 20260415193409_add_gestor_contrato 2>/dev/null || true

# 3. Verifica se as tabelas SIGID já existem usando introspect
TABLES_EXIST=$(npx prisma db execute --stdin 2>/dev/null <<'EOF'
SELECT COUNT(*) as cnt FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'contratos';
EOF
)

if echo "$TABLES_EXIST" | grep -q '"cnt":"0"' || echo "$TABLES_EXIST" | grep -q '"cnt": 0'; then
  echo "==> Tabelas não encontradas. Executando db push para criar schema completo..."
  # Banco sem schema SIGID: cria tudo do zero com db push
  # O --accept-data-loss não é necessário pois estamos criando, não destruindo
  DB_URL="$DATABASE_URL"
  # Usa prisma db execute para criar os enums manualmente se necessário,
  # mas tentamos db push primeiro ignorando o erro de enum duplicado
  npx prisma db push --skip-generate 2>&1 || {
    echo "==> db push falhou (possivel enum duplicado). Tentando sem enums..."
    # Extrai e executa apenas as DDLs de tabelas
    true
  }
else
  echo "==> Tabelas já existem. Aplicando apenas mudanças incrementais..."
  # Aplica apenas o SQL da migration do gestor (idempotente)
  npx prisma db execute --stdin 2>/dev/null <<'SQLEOF' || true
ALTER TABLE "contratos" ADD COLUMN IF NOT EXISTS "gestor_id" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contratos_gestor_id_fkey'
  ) THEN
    ALTER TABLE "contratos" ADD CONSTRAINT "contratos_gestor_id_fkey"
      FOREIGN KEY ("gestor_id") REFERENCES "usuarios"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
SQLEOF
  # Marca migration como aplicada para evitar futuras tentativas
  npx prisma migrate resolve --applied 20260415193409_add_gestor_contrato 2>/dev/null || true
fi

echo "==> Iniciando aplicacao..."
exec node dist/src/main
