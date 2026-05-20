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
)
ON CONFLICT (tenant_id, email) DO UPDATE SET
  senha_hash = '$2b$12$BZ6BtGZnU1ZQ5eXVieJJR.3RBwNQZsVfsmlbtKgrd7TDJe5I3dkTm',
  ativo = true;
