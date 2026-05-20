/**
 * Tenant Isolation (E2E)
 *
 * Validates that the Prisma middleware Row-Level Security pattern correctly
 * isolates data between tenants. A user authenticated as Tenant B must never
 * see, modify, or access resources belonging to Tenant A.
 */
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  cleanDatabase,
  createTestApp,
  getTestToken,
  seedE2eTenant,
  seedSecondTenant,
  E2ESeed,
} from './helpers/app.helper';

describe('Tenant Isolation (e2e)', () => {
  let app: INestApplication;
  let tenantA: E2ESeed;
  let tenantB: E2ESeed;
  let tokenA: string;
  let tokenB: string;

  // IDs of resources created in Tenant A
  let fornecedorAId: string;
  let contratoAId: string;
  let pendenciaAId: string;

  beforeAll(async () => {
    app = await createTestApp();
    [tenantA, tenantB] = await Promise.all([seedE2eTenant(app), seedSecondTenant(app)]);
    [tokenA, tokenB] = await Promise.all([
      getTestToken(app, tenantA.gestorId, 'GESTOR', tenantA.tenantId),
      getTestToken(app, tenantB.gestorId, 'GESTOR', tenantB.tenantId),
    ]);
  });

  afterAll(async () => {
    await cleanDatabase(app, tenantA.tenantId);
    await cleanDatabase(app, tenantB.tenantId);
    await app.close();
  });

  // ─── Seed data in Tenant A ──────────────────────────────────────────────────

  describe('Setup: criar dados no Tenant A', () => {
    it('Tenant A cria um fornecedor', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/fornecedores')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          nome: 'Fornecedor Exclusivo Tenant A',
          cnpj: '55.666.777/0001-88',
          email: 'exclusive@tenanta.test',
        })
        .expect(201);

      fornecedorAId = res.body.id;
      expect(res.body.tenantId).toBe(tenantA.tenantId);
    });

    it('Tenant A cria um contrato', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          numero: `CTR-ISOLATION-${Date.now()}`,
          objeto: 'Contrato exclusivo Tenant A',
          modalidade: 'servicos',
          valor: 50000,
          dataInicio: '2026-01-01',
          dataTermino: '2027-01-01',
          fornecedorId: tenantA.fornecedorId,
          responsavelId: tenantA.gestorId,
        })
        .expect(201);

      contratoAId = res.body.id;
      expect(res.body.tenantId).toBe(tenantA.tenantId);
    });

    it('Tenant A cria uma pendência', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          titulo: 'Pendência exclusiva Tenant A',
          descricao: 'Somente Tenant A deve ver',
          origem: 'auditoria_interna',
          responsavelId: tenantA.respId,
          prazoResposta: '2027-06-30',
        })
        .expect(201);

      pendenciaAId = res.body.id;
      expect(res.body.tenantId).toBe(tenantA.tenantId);
    });
  });

  // ─── Tenant B tries to see Tenant A's data ──────────────────────────────────

  describe('Tenant B não enxerga dados do Tenant A', () => {
    it('GET /fornecedores — Tenant B não vê fornecedores do Tenant A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/fornecedores')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const ids = res.body.data.map((f: any) => f.id);
      expect(ids).not.toContain(fornecedorAId);
      res.body.data.forEach((f: any) => {
        expect(f.tenantId).toBe(tenantB.tenantId);
      });
    });

    it('GET /contratos — Tenant B não vê contratos do Tenant A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/contratos')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const ids = res.body.data.map((c: any) => c.id);
      expect(ids).not.toContain(contratoAId);
      res.body.data.forEach((c: any) => {
        expect(c.tenantId).toBe(tenantB.tenantId);
      });
    });

    it('GET /pendencias — Tenant B não vê pendências do Tenant A', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/pendencias')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const ids = res.body.data.map((p: any) => p.id);
      expect(ids).not.toContain(pendenciaAId);
      res.body.data.forEach((p: any) => {
        expect(p.tenantId).toBe(tenantB.tenantId);
      });
    });

    it('GET /contratos/:id — Tenant B recebe 404 ao acessar contrato do Tenant A', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/contratos/${contratoAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('GET /pendencias/:id — Tenant B recebe 404 ao acessar pendência do Tenant A', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/pendencias/${pendenciaAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('GET /fornecedores/:id — Tenant B recebe 404 ao acessar fornecedor do Tenant A', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/fornecedores/${fornecedorAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  // ─── Tenant A still sees its own data ───────────────────────────────────────

  describe('Tenant A ainda enxerga seus próprios dados', () => {
    it('GET /contratos — Tenant A vê o contrato criado', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/contratos')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const ids = res.body.data.map((c: any) => c.id);
      expect(ids).toContain(contratoAId);
    });

    it('GET /pendencias/:id — Tenant A acessa sua própria pendência (200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pendencias/${pendenciaAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.id).toBe(pendenciaAId);
      expect(res.body.tenantId).toBe(tenantA.tenantId);
    });
  });

  // ─── CNPJ uniqueness is per-tenant, not global ──────────────────────────────

  describe('Unicidade de CNPJ é por tenant, não global', () => {
    it('Tenant B pode cadastrar fornecedor com o mesmo CNPJ do Tenant A', async () => {
      // Tenant A's fornecedor uses cnpj '55.666.777/0001-88'
      const res = await request(app.getHttpServer())
        .post('/api/v1/fornecedores')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          nome: 'Fornecedor B com CNPJ igual ao A',
          cnpj: '55.666.777/0001-88',
          email: 'dup-cnpj@tenantb.test',
        })
        .expect(201);

      expect(res.body.tenantId).toBe(tenantB.tenantId);
    });

    it('Tenant A rejeita CNPJ duplicado dentro do próprio tenant (409)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/fornecedores')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          nome: 'Segundo Fornecedor A com CNPJ duplicado',
          cnpj: '55.666.777/0001-88',
        })
        .expect(409);
    });
  });
});
