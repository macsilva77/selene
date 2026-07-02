import { PrismaClient, PlanoTenant } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // ─── Tenant padrão ─────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'selene-default' },
    update: {},
    create: {
      nome: 'Selene — Organização Padrão',
      slug: 'selene-default',
      cnpj: '00.000.000/0001-00',
      plano: PlanoTenant.enterprise,
      ativo: true,
    },
  });
  console.log(`  ✓ Tenant: ${tenant.slug} [${tenant.plano}]`);

  // ─── Usuários padrão por perfil ────────────────────────────────────────────
  const hash = await bcrypt.hash('Admin@123456', 12);

  const usuarios = [
    { nome: 'Administrador', email: 'admin@sigic.gov.br', role: 'ADMIN' },
    { nome: 'Gestor de Contratos', email: 'gestor@sigic.gov.br', role: 'GESTOR' },
    { nome: 'Responsável Técnico', email: 'responsavel@sigic.gov.br', role: 'RESP' },
    { nome: 'Auditor Interno', email: 'auditor.int@sigic.gov.br', role: 'AUD_INT' },
    { nome: 'Auditor Externo', email: 'auditor.ext@sigic.gov.br', role: 'AUD_EXT' },
    { nome: 'Diretor Executivo', email: 'diretor@sigic.gov.br', role: 'EXEC' },
  ];

  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: {
        tenantId: tenant.id,
        nome: u.nome,
        email: u.email,
        senhaHash: hash,
        role: u.role as any,
      },
    });
    console.log(`  ✓ Usuário: ${u.email} [${u.role}]`);
  }

  // ─── Fornecedor de exemplo ──────────────────────────────────────────────────
  await prisma.fornecedor.upsert({
    where: { tenantId_cnpj: { tenantId: tenant.id, cnpj: '11.111.111/0001-11' } },
    update: {},
    create: {
      tenantId: tenant.id,
      nome: 'Fornecedor Exemplo LTDA',
      cnpj: '11.111.111/0001-11',
      email: 'contato@fornecedor-exemplo.com',
    },
  });
  console.log('  ✓ Fornecedor de exemplo');

  // ─── Michael Alessander ────────────────────────────────────────────────────
  await prisma.usuario.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'michael.alessander@gmail.com' } },
    update: {},
    create: {
      id: '743d2f4f-f822-411f-99dd-f0a7db185de1',
      tenantId: tenant.id,
      nome: 'Michael Alessander',
      email: 'michael.alessander@gmail.com',
      senhaHash: hash,
      role: 'ADMIN' as any,
    },
  });
  console.log('  ✓ Usuário: michael.alessander@gmail.com [ADMIN]');

  // ─── Perfil Administrador com todas as permissões ──────────────────────────
  const ALL_PERMISSIONS = [
    'dashboard.view',
    'fornecedores.view', 'fornecedores.create', 'fornecedores.edit', 'fornecedores.inativar',
    'usuarios.view', 'usuarios.create', 'usuarios.manage',
    'perfis.view', 'perfis.manage',
    'auditoria.view',
    'relatorios.view',
    // Permissões de Certificados Digitais A1
    'certificados.view',
    'certificados.manage',
    // Permissões de Unidades e Empresas
    'unidades.view', 'unidades.manage',
    'empresas.view', 'empresas.manage',
    // Permissões de DF-e Distribuição
    'dfe.view', 'dfe.manage',
    // Permissões de CT-e Distribuição
    'cte.view', 'cte.manage',
    // Permissões de Etiquetas
    'etiquetas.view', 'etiquetas.create', 'etiquetas.edit', 'etiquetas.delete',
    // Permissões de Obrigações Acessórias
    'obrigacoes-acessorias.view',
    // Permissões de Análise de Crédito
    'analise-credito.view',
    'analise-credito.processar',
    'analise-credito.regras',
  ];

  // Use raw SQL to upsert perfil (bypasses stale Prisma client types)
  await prisma.$executeRaw`
    INSERT INTO perfis (id, tenant_id, nome, descricao, role, permissoes, ativo, criado_em, atualizado_em)
    VALUES (
      gen_random_uuid(),
      ${tenant.id},
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
  console.log(`  ✓ Perfil: Administrador [${ALL_PERMISSIONS.length} permissões]`);

  // Atribuir Michael ao perfil Administrador
  const michael = await prisma.usuario.findFirst({
    where: { tenantId: tenant.id, email: 'michael.alessander@gmail.com' },
  });
  const perfilAdminRow = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM perfis WHERE tenant_id = ${tenant.id} AND nome = 'Administrador' LIMIT 1
  `;
  const perfilAdminId = perfilAdminRow[0]?.id;
  if (michael && perfilAdminId) {
    await prisma.$executeRaw`
      INSERT INTO usuario_perfis (usuario_id, perfil_id, atribuido_em)
      VALUES (${michael.id}, ${perfilAdminId}, now())
      ON CONFLICT (usuario_id, perfil_id) DO NOTHING
    `;
    console.log(`  ✓ Michael Alessander → Perfil Administrador`);
  }

  console.log('\n✅ Seed concluído!');
  console.log('\n📋 Credenciais padrão (todos os perfis): senha = Admin@123456');
  console.log(`📋 Tenant slug padrão: ${tenant.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
