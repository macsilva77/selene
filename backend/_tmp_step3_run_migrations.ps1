# Execute este script no terminal do projeto SIGID
# Ele aponta o Prisma para o banco sigid e roda todas as migrations do zero

$env:DATABASE_URL = "postgresql://postgres:T0nOQLhDUVk8juKOj8hGxQ@brsupercarga-db.cyjik0uca89e.us-east-1.rds.amazonaws.com:5432/sigid?sslmode=require"

Write-Host "Rodando migrations no banco sigid..."
npx prisma migrate deploy

Write-Host ""
Write-Host "Inserindo tenant e usuario admin..."
npx prisma db execute --url $env:DATABASE_URL --stdin << @SQL
INSERT INTO tenants (id, nome, slug, plano, ativo, criado_em, atualizado_em)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'SIGID',
  'default',
  'professional',
  true,
  now(),
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO usuarios (id, tenant_id, nome, email, senha_hash, role, ativo, criado_em, atualizado_em)
VALUES (
  '743d2f4f-f822-411f-99dd-f0a7db185de1',
  '00000000-0000-0000-0000-000000000001',
  'Michael Alessander',
  'michael.alessander@gmail.com',
  '$2b$12$BZ6BtGZnU1ZQ5eXVieJJR.3RBwNQZsVfsmlbtKgrd7TDJe5I3dkTm',
  'ADMIN',
  true,
  now(),
  now()
) ON CONFLICT (tenant_id, email) DO NOTHING;
@SQL
