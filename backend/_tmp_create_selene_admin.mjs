import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://sigic:sigic123@localhost:15432/sigic_dev?schema=public' } },
});

const TENANT_ID = '7c8383f4-fd5c-4baf-adc7-0c6c5b7f6b96'; // selene-default

const ALL_PERMISSIONS = [
  'dashboard.view',
  'fornecedores.view','fornecedores.create','fornecedores.edit','fornecedores.inativar',
  'usuarios.view','usuarios.create','usuarios.manage',
  'perfis.view','perfis.manage',
  'auditoria.view','relatorios.view',
  'certificados.view','certificados.manage',
  'unidades.view','unidades.manage',
  'empresas.view','empresas.manage',
  'dfe.view','dfe.manage',
];

async function main() {
  const hash = await bcrypt.hash('Admin@123456', 12);

  // Cria o usuário Michael sem UUID fixo
  const michael = await prisma.usuario.upsert({
    where: { tenantId_email: { tenantId: TENANT_ID, email: 'michael.alessander@gmail.com' } },
    update: { senhaHash: hash },
    create: {
      tenantId: TENANT_ID,
      nome: 'Michael Alessander',
      email: 'michael.alessander@gmail.com',
      senhaHash: hash,
      role: 'ADMIN',
    },
  });
  console.log('✓ Usuário criado:', michael.email, michael.id);

  // Cria o perfil Administrador
  await prisma.$executeRaw`
    INSERT INTO perfis (id, tenant_id, nome, descricao, role, permissoes, ativo, criado_em, atualizado_em)
    VALUES (
      gen_random_uuid(),
      ${TENANT_ID},
      'Administrador',
      'Acesso total ao sistema.',
      'ADMIN',
      ${ALL_PERMISSIONS}::text[],
      true,
      now(),
      now()
    )
    ON CONFLICT (tenant_id, nome)
    DO UPDATE SET permissoes = ${ALL_PERMISSIONS}::text[], atualizado_em = now()
  `;
  console.log('✓ Perfil Administrador criado/atualizado');

  // Associa Michael ao perfil Administrador
  const [perfil] = await prisma.$queryRaw`
    SELECT id FROM perfis WHERE tenant_id = ${TENANT_ID} AND nome = 'Administrador' LIMIT 1
  `;
  await prisma.$executeRaw`
    INSERT INTO usuario_perfis (usuario_id, perfil_id, atribuido_em)
    VALUES (${michael.id}, ${perfil.id}, now())
    ON CONFLICT (usuario_id, perfil_id) DO NOTHING
  `;
  console.log('✓ Michael → Perfil Administrador');
  console.log('\n✅ Pronto! Login: michael.alessander@gmail.com / Admin@123456');
}

main().catch(console.error).finally(() => prisma.$disconnect());
