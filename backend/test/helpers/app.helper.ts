import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { JwtService } from '@nestjs/jwt';

export interface TestUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  accessToken: string;
}

export interface E2ESeed {
  tenantId: string;
  adminId: string;
  gestorId: string;
  respId: string;
  fornecedorId: string;
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

export async function getTestToken(
  app: INestApplication,
  userId: string,
  role: string,
  tenantId: string,
): Promise<string> {
  const jwtService = app.get(JwtService);
  return jwtService.sign({ sub: userId, email: `${role.toLowerCase()}@test.com`, role, tenantId });
}

export async function cleanDatabase(app: INestApplication, tenantId = 'e2e00000-0000-4000-a000-000000000001'): Promise<void> {
  const prisma = app.get(PrismaService);
  // Desabilita regras de imutabilidade para o cleanup de testes
  await prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE RULE no_delete_audit_logs');
  await prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE RULE no_update_audit_logs');
  try {
    await prisma.$executeRawUnsafe('DELETE FROM audit_logs WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe('DELETE FROM notificacoes WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe('DELETE FROM documentos WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe(
      'DELETE FROM movimentacoes_pendencia WHERE pendencia_id IN (SELECT id FROM pendencias WHERE tenant_id = $1)',
      tenantId,
    );
    await prisma.$executeRawUnsafe('DELETE FROM pendencias WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe(
      'DELETE FROM aditivos WHERE contrato_id IN (SELECT id FROM contratos WHERE tenant_id = $1)',
      tenantId,
    );
    await prisma.$executeRawUnsafe('DELETE FROM processos_licitatorios WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe(
      'DELETE FROM iniciativas_contratos WHERE contrato_id IN (SELECT id FROM contratos WHERE tenant_id = $1)',
      tenantId,
    );
    await prisma.$executeRawUnsafe(
      'DELETE FROM marcos WHERE iniciativa_id IN (SELECT id FROM iniciativas WHERE tenant_id = $1)',
      tenantId,
    );
    await prisma.$executeRawUnsafe('DELETE FROM iniciativas WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe('DELETE FROM contratos WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe('DELETE FROM fornecedores WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe('DELETE FROM config_licitacoes WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe('DELETE FROM config_notificacoes WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe('DELETE FROM usuarios WHERE tenant_id = $1', tenantId);
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, tenantId);
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE RULE no_delete_audit_logs');
    await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE RULE no_update_audit_logs');
  }
}

export async function seedE2eTenant(app: INestApplication): Promise<E2ESeed> {
  const prisma = app.get(PrismaService);
  const bcrypt = await import('bcrypt');

  const tenant = await prisma.tenant.upsert({
    where: { id: 'e2e00000-0000-4000-a000-000000000001' },
    create: { id: 'e2e00000-0000-4000-a000-000000000001', nome: 'Tenant E2E', slug: 'e2e-test', plano: 'professional' },
    update: {},
  });

  const senhaHash = await bcrypt.hash('Senha@123456', 10);

  const [admin, gestor, resp] = await Promise.all([
    prisma.usuario.upsert({
      where: { id: 'e2e00000-0000-4000-a000-000000000002' },
      create: {
        id: 'e2e00000-0000-4000-a000-000000000002',
        tenantId: tenant.id,
        nome: 'Admin E2E',
        email: 'admin@e2e.test',
        senhaHash,
        role: 'ADMIN',
      },
      update: {},
    }),
    prisma.usuario.upsert({
      where: { id: 'e2e00000-0000-4000-a000-000000000003' },
      create: {
        id: 'e2e00000-0000-4000-a000-000000000003',
        tenantId: tenant.id,
        nome: 'Gestor E2E',
        email: 'gestor@e2e.test',
        senhaHash,
        role: 'GESTOR',
      },
      update: {},
    }),
    prisma.usuario.upsert({
      where: { id: 'e2e00000-0000-4000-a000-000000000004' },
      create: {
        id: 'e2e00000-0000-4000-a000-000000000004',
        tenantId: tenant.id,
        nome: 'Resp E2E',
        email: 'resp@e2e.test',
        senhaHash,
        role: 'RESP',
      },
      update: {},
    }),
  ]);

  const fornecedor = await prisma.fornecedor.upsert({
    where: { id: 'e2e00000-0000-4000-a000-000000000005' },
    create: {
      id: 'e2e00000-0000-4000-a000-000000000005',
      tenantId: tenant.id,
      nome: 'Fornecedor E2E Ltda',
      cnpj: '11.222.333/0001-44',
      email: 'fornecedor@e2e.test',
    },
    update: {},
  });

  return {
    tenantId: tenant.id,
    adminId: admin.id,
    gestorId: gestor.id,
    respId: resp.id,
    fornecedorId: fornecedor.id,
  };
}

export async function seedSecondTenant(app: INestApplication): Promise<E2ESeed> {
  const prisma = app.get(PrismaService);
  const bcrypt = await import('bcrypt');

  const tenant = await prisma.tenant.upsert({
    where: { id: 'e2e00000-0000-4000-b000-000000000001' },
    create: { id: 'e2e00000-0000-4000-b000-000000000001', nome: 'Tenant B E2E', slug: 'e2e-test-b', plano: 'free' },
    update: {},
  });

  const senhaHash = await bcrypt.hash('Senha@123456', 10);

  const [admin, gestor, resp] = await Promise.all([
    prisma.usuario.upsert({
      where: { id: 'e2e00000-0000-4000-b000-000000000002' },
      create: {
        id: 'e2e00000-0000-4000-b000-000000000002',
        tenantId: tenant.id,
        nome: 'Admin Tenant B',
        email: 'admin@e2e-b.test',
        senhaHash,
        role: 'ADMIN',
      },
      update: {},
    }),
    prisma.usuario.upsert({
      where: { id: 'e2e00000-0000-4000-b000-000000000003' },
      create: {
        id: 'e2e00000-0000-4000-b000-000000000003',
        tenantId: tenant.id,
        nome: 'Gestor Tenant B',
        email: 'gestor@e2e-b.test',
        senhaHash,
        role: 'GESTOR',
      },
      update: {},
    }),
    prisma.usuario.upsert({
      where: { id: 'e2e00000-0000-4000-b000-000000000004' },
      create: {
        id: 'e2e00000-0000-4000-b000-000000000004',
        tenantId: tenant.id,
        nome: 'Resp Tenant B',
        email: 'resp@e2e-b.test',
        senhaHash,
        role: 'RESP',
      },
      update: {},
    }),
  ]);

  const fornecedor = await prisma.fornecedor.upsert({
    where: { id: 'e2e00000-0000-4000-b000-000000000005' },
    create: {
      id: 'e2e00000-0000-4000-b000-000000000005',
      tenantId: tenant.id,
      nome: 'Fornecedor B E2E Ltda',
      cnpj: '99.888.777/0001-11',
      email: 'fornecedor@e2e-b.test',
    },
    update: {},
  });

  return {
    tenantId: tenant.id,
    adminId: admin.id,
    gestorId: gestor.id,
    respId: resp.id,
    fornecedorId: fornecedor.id,
  };
}
