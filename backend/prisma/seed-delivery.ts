/**
 * seed-delivery.ts
 *
 * Limpa TODA a base de dados e recria apenas o estado mínimo de entrega:
 *   - 1 Tenant padrão
 *   - 1 Usuário Administrador  →  admin@sigic.com.br / Senha@123
 *   - 1 Perfil "Administrador" com todas as permissões, associado ao usuário
 *   - Configurações padrão de licitação
 *
 * Uso:
 *   npx ts-node prisma/seed-delivery.ts
 *
 * No EC2 via docker exec:
 *   docker exec sigic npx ts-node prisma/seed-delivery.ts
 */

import { PrismaClient, PlanoTenant } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('\n⚠️  SEED DE ENTREGA — limpando a base...\n');

  // ─── Limpeza em ordem reversa de dependências ──────────────────────────────
  // DF-e
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dfe_manifestacoes              RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dfe_gap_nsus                   RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dfe_documentos                 RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dfe_lotes                      RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dfe_nsu_controles              RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dfe_auditorias                 RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dfe_configs                    RESTART IDENTITY CASCADE');
  // Certificados
  await prisma.$executeRawUnsafe('TRUNCATE TABLE certificados_logs              RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE certificados_empresas          RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE procuracoes_eletronicas        RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE certificados_digitais          RESTART IDENTITY CASCADE');
  // Documentos Regulatórios
  await prisma.$executeRawUnsafe('TRUNCATE TABLE assinaturas_doc_reg            RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE signatarios_doc_reg            RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE revisores_doc_reg              RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE revisoes_doc_reg               RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE workflow_revisores_tipo_doc    RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE workflow_signatarios_tipo_doc  RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE documentos_reg                 RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE tipos_documento_reg            RESTART IDENTITY CASCADE');
  // Unidades
  await prisma.$executeRawUnsafe('TRUNCATE TABLE unidade_visibilidades          RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usuario_unidades               RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE unidades_organizacionais       RESTART IDENTITY CASCADE');
  // Core
  await prisma.$executeRawUnsafe('TRUNCATE TABLE audit_logs                     RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE documentos                     RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE movimentacoes_pendencia        RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE pendencias                     RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE atualizacoes_iniciativa        RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE marcos                         RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE iniciativas_contratos          RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE iniciativas                    RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE termos_aditivos                RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE aditivos                       RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE contratos                      RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE tipos_origem                   RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE board_colunas                  RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE fornecedores                   RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE empresas                       RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE notificacoes                   RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE calendario_integracoes         RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usuario_perfis                 RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE perfis                         RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE config_notificacoes            RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usuarios                       RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE tenants                        RESTART IDENTITY CASCADE');

  console.log('  ✓ Todos os dados removidos\n');

  // ─── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.create({
    data: {
      nome:  'SIGIC — Gestão de Contratos',
      slug:  'sigic-default',
      cnpj:  '00.000.000/0001-00',
      plano: PlanoTenant.enterprise,
      ativo: true,
    },
  });
  console.log(`  ✓ Tenant criado: ${tenant.slug}`);

  // ─── Senha padrão de entrega ───────────────────────────────────────────────
  const senhaHash = await bcrypt.hash('Senha@123', 12);

  // ─── Usuário Administrador ─────────────────────────────────────────────────
  const admin = await prisma.usuario.create({
    data: {
      tenantId:  tenant.id,
      nome:      'Administrador',
      email:     'admin@sigic.com.br',
      senhaHash,
      role:      'ADMIN' as any,
      ativo:     true,
    },
  });
  console.log(`  ✓ Usuário criado: ${admin.email} [ADMIN]`);

  // ─── Perfil Administrador com todas as permissões ──────────────────────────
  const ALL_PERMISSIONS = [
    'dashboard.view',
    'contratos.view', 'contratos.create', 'contratos.edit', 'contratos.delete', 'contratos.documentos',
    'pendencias.view', 'pendencias.create', 'pendencias.responder', 'pendencias.aceitar', 'pendencias.encaminhar', 'pendencias.documentos',
    'iniciativas.view', 'iniciativas.create', 'iniciativas.edit', 'iniciativas.delete',
    'board.view',
    'calendario.view', 'calendario.integrar',
    'fornecedores.view', 'fornecedores.create', 'fornecedores.edit', 'fornecedores.inativar',
    'usuarios.view', 'usuarios.create', 'usuarios.manage', 'usuarios.delete',
    'perfis.view', 'perfis.manage',
    'origens.view', 'origens.manage',
    'auditoria.view',
    'relatorios.view',
    'config-notificacoes.view', 'config-notificacoes.manage',
    'unidades.view', 'unidades.create', 'unidades.edit',
    'configuracoes.manage',
    'empresas.view', 'empresas.create', 'empresas.edit', 'empresas.inativar',
    'documentos-reg.view', 'documentos-reg.manage',
  ];

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
  `;
  console.log(`  ✓ Perfil criado: Administrador (${ALL_PERMISSIONS.length} permissões)`);

  const perfil = await prisma.perfil.findFirst({
    where: { tenantId: tenant.id, nome: 'Administrador' },
  });

  if (perfil) {
    await prisma.usuarioPerfil.create({
      data: { usuarioId: admin.id, perfilId: perfil.id },
    });
    console.log('  ✓ Perfil atribuído ao administrador');
  }

  // ─── Resumo ────────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ENTREGA PRONTA 🚀');
  console.log('  URL:   https://sigic.inovaprojetosti.com.br');
  console.log('  Login: admin@sigic.com.br');
  console.log('  Senha: Senha@123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
