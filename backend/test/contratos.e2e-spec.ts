import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  cleanDatabase,
  createTestApp,
  getTestToken,
  seedE2eTenant,
  E2ESeed,
} from './helpers/app.helper';

describe('Contratos (e2e)', () => {
  let app: INestApplication;
  let seed: E2ESeed;
  let adminToken: string;
  let gestorToken: string;
  let respToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    seed = await seedE2eTenant(app);
    [adminToken, gestorToken, respToken] = await Promise.all([
      getTestToken(app, seed.adminId, 'ADMIN', seed.tenantId),
      getTestToken(app, seed.gestorId, 'GESTOR', seed.tenantId),
      getTestToken(app, seed.respId, 'RESP', seed.tenantId),
    ]);
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  const contratoBase = () => ({
    numero: `CTR-E2E-${Date.now()}`,
    objeto: 'Prestação de serviços de TI E2E',
    modalidade: 'servicos',
    valor: 150000,
    dataInicio: '2026-01-01',
    dataTermino: '2027-01-01',
    renovavel: false,
  });

  describe('POST /api/v1/contratos', () => {
    it('gestor deve criar contrato com sucesso (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({
          ...contratoBase(),
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.numero).toMatch(/^CTR-E2E-/);
      expect(res.body.tenantId).toBe(seed.tenantId);
    });

    it('admin deve criar contrato com renovável=true (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...contratoBase(),
          numero: `CTR-E2E-REN-${Date.now()}`,
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
          renovavel: true,
          maxRenovacoes: 3,
        })
        .expect(201);

      expect(res.body.renovavel).toBe(true);
      expect(res.body.maxRenovacoes).toBe(3);
    });

    it('deve retornar 403 quando RESP tenta criar contrato', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${respToken}`)
        .send({
          ...contratoBase(),
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.respId,
        })
        .expect(403);
    });

    it('deve retornar 401 sem autenticação', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .send({
          ...contratoBase(),
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
        })
        .expect(401);
    });

    it('deve retornar 400 quando dataTermino <= dataInicio', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({
          ...contratoBase(),
          dataInicio: '2026-06-01',
          dataTermino: '2026-01-01',
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
        })
        .expect(400);
    });

    it('deve retornar 409 em número duplicado', async () => {
      const numero = `CTR-DEDUP-${Date.now()}`;
      const payload = {
        ...contratoBase(),
        numero,
        fornecedorId: seed.fornecedorId,
        responsavelId: seed.gestorId,
      };

      await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send(payload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send(payload)
        .expect(409);
    });
  });

  describe('GET /api/v1/contratos', () => {
    let contratoId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({
          ...contratoBase(),
          numero: `CTR-LIST-${Date.now()}`,
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
        });
      contratoId = res.body.id;
    });

    it('deve listar contratos do tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((c: any) => {
        expect(c.tenantId).toBe(seed.tenantId);
      });
    });

    it('deve suportar paginação', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/contratos?page=1&limit=5')
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(5);
      expect(typeof res.body.meta.total).toBe('number');
    });

    it('deve retornar semáforo em cada contrato', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      const found = res.body.data.find((c: any) => c.id === contratoId);
      expect(found).toBeDefined();
      expect(['verde', 'amarelo', 'vermelho']).toContain(found.semaforo);
      expect(typeof found.diasRestantes).toBe('number');
    });
  });

  describe('GET /api/v1/contratos/:id', () => {
    let contratoId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({
          ...contratoBase(),
          numero: `CTR-GET-${Date.now()}`,
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
        });
      contratoId = res.body.id;
    });

    it('deve retornar contrato por ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/contratos/${contratoId}`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body.id).toBe(contratoId);
      expect(res.body.tenantId).toBe(seed.tenantId);
      expect(res.body).toHaveProperty('responsavel');
      expect(res.body).toHaveProperty('fornecedor');
    });

    it('deve retornar 404 para ID inexistente', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/contratos/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(404);
    });
  });

  describe('POST /api/v1/contratos/:id/renovar', () => {
    let contratoRenovavelId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({
          ...contratoBase(),
          numero: `CTR-RENOV-${Date.now()}`,
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
          renovavel: true,
          maxRenovacoes: 2,
        });
      contratoRenovavelId = res.body.id;
    });

    it('deve renovar contrato com sucesso', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/contratos/${contratoRenovavelId}/renovar`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({ novaDataTermino: '2028-01-01', motivo: 'Renovação E2E' })
        .expect(200);

      expect(new Date(res.body.dataTermino).getFullYear()).toBe(2028);
      expect(res.body.renovacoesFeiras).toBe(1);
    });

    it('deve retornar 400 ao tentar renovar contrato não renovável', async () => {
      const naoRenovavelRes = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({
          ...contratoBase(),
          numero: `CTR-NREN-${Date.now()}`,
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
          renovavel: false,
        });

      await request(app.getHttpServer())
        .post(`/api/v1/contratos/${naoRenovavelRes.body.id}/renovar`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({ novaDataTermino: '2028-01-01' })
        .expect(400);
    });
  });

  describe('POST /api/v1/contratos/:id/inativar', () => {
    let contratoId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/contratos')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({
          ...contratoBase(),
          numero: `CTR-INAT-${Date.now()}`,
          fornecedorId: seed.fornecedorId,
          responsavelId: seed.gestorId,
        });
      contratoId = res.body.id;
    });

    it('deve encerrar contrato com motivo', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/contratos/${contratoId}/inativar`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({ motivo: 'Encerramento antecipado E2E' })
        .expect(200);

      expect(res.body.status).toBe('encerrado');
    });

    it('deve retornar 400 ao tentar encerrar contrato já encerrado', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/contratos/${contratoId}/inativar`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({ motivo: 'Segundo encerramento' })
        .expect(400);
    });
  });
});
