// $executeRaw com tagged template — 'ADMIN'::"Role" fica no SQL literal, não como parâmetro
const { PrismaClient } = require('@prisma/client');
const HASH = '$2b$12$rFIx3pm1oinHBE4NoJoe4eq.ggce7nKvuPszBuuQSySlFK2jBUHUS';
const p = new PrismaClient();

async function run() {
  // Verifica usuários existentes primeiro
  const existing = await p.$queryRaw`SELECT id, email, ativo FROM usuarios LIMIT 10`;
  console.log('Existentes:', JSON.stringify(existing));

  // INSERT com enum literal no SQL (não como parâmetro)
  const rows = await p.$executeRaw`
    INSERT INTO usuarios (id, tenant_id, nome, email, senha_hash, role, ativo, criado_em, atualizado_em)
    VALUES (
      '743d2f4f-f822-411f-99dd-f0a7db185de1',
      '00000000-0000-0000-0000-000000000001',
      'Michael Alessander',
      'michael.alessander@gmail.com',
      ${HASH},
      'ADMIN'::"Role",
      true,
      now(),
      now()
    )
    ON CONFLICT (tenant_id, email) DO UPDATE SET senha_hash = ${HASH}, ativo = true
  `;
  console.log('Upsert rows:', rows);
  process.exit(0);
}

run().catch(e => { console.error('ERRO:', e.message); process.exit(1); });


