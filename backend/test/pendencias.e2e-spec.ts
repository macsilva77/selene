import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  cleanDatabase,
  createTestApp,
  getTestToken,
  seedE2eTenant,
  E2ESeed,
} from './helpers/app.helper';

describe('Pendências (e2e)', () => {
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

  const pendenciaBase = () => ({
    titulo: `Pendência E2E ${Date.now()}`,
    descricao: 'Descrição detalhada da pendência E2E',
    origem: 'auditoria_interna',
    responsavelId: seed.respId,
    prazoResposta: '2027-06-30',
  });

  describe('POST /api/v1/pendencias', () => {
    it('gestor deve criar pendência com sucesso (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send(pendenciaBase())
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.status).toBe('aguardando_resposta');
      expect(res.body.tenantId).toBe(seed.tenantId);
      expect(res.body.responsavelId).toBe(seed.respId);
    });

    it('admin deve criar pendência com origem banco_central (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...pendenciaBase(), origem: 'banco_central', refExterna: 'BCB-2026-0042' })
        .expect(201);

      expect(res.body.origem).toBe('banco_central');
      expect(res.body.refExterna).toBe('BCB-2026-0042');
    });

    it('deve retornar 400 com origem inválida', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send({ ...pendenciaBase(), origem: 'origem_invalida' })
        .expect(400);
    });

    it('deve retornar 401 sem autenticação', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .send(pendenciaBase())
        .expect(401);
    });
  });

  describe('GET /api/v1/pendencias', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send(pendenciaBase());
    });

    it('deve listar pendências do tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/pendencias')
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(Array.isArray(res.body.data)).toBe(true);
      res.body.data.forEach((p: any) => {
        expect(p.tenantId).toBe(seed.tenantId);
      });
    });

    it('deve filtrar por status=aguardando_resposta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/pendencias?status=aguardando_resposta')
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      res.body.data.forEach((p: any) => {
        expect(p.status).toBe('aguardando_resposta');
      });
    });

    it('RESP vê apenas as suas próprias pendências em /minhas', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/pendencias/minhas')
        .set('Authorization', `Bearer ${respToken}`)
        .expect(200);

      res.body.data.forEach((p: any) => {
        expect(p.responsavelId).toBe(seed.respId);
      });
    });
  });

  describe('Fluxo completo de uma pendência', () => {
    let pendenciaId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send(pendenciaBase());
      pendenciaId = res.body.id;
    });

    it('deve retornar pendência por ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pendencias/${pendenciaId}`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body.id).toBe(pendenciaId);
      expect(res.body.tenantId).toBe(seed.tenantId);
    });

    it('responsável deve registrar movimentação (comentário)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/movimentacoes`)
        .set('Authorization', `Bearer ${respToken}`)
        .send({ texto: 'Estamos analisando a documentação solicitada.' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
    });

    it('responsável deve responder a pendência', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/responder`)
        .set('Authorization', `Bearer ${respToken}`)
        .send({ texto: 'Documentação enviada conforme solicitado.' })
        .expect(200);

      expect(res.body).toHaveProperty('message');
    });

    it('admin deve aceitar a resposta e encerrar', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/aceitar`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('message');
    });

    it('deve retornar 404 para ID inexistente', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/pendencias/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(404);
    });
  });

  describe('Devolução e reobertura', () => {
    let pendenciaId: string;

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send(pendenciaBase());
      pendenciaId = created.body.id;

      // Responsável responde
      await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/responder`)
        .set('Authorization', `Bearer ${respToken}`)
        .send({ texto: 'Resposta inicial' });
    });

    it('admin deve devolver a pendência com novo prazo', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/devolver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ motivoDevolucao: 'Documentação incompleta', novoPrazo: '2027-09-30' })
        .expect(200);

      expect(res.body).toHaveProperty('message');
    });
  });

  // ─── Regressão: destinatarioId imutável ao longo do fluxo completo ───────────
  describe('Regressão — destinatarioId (criar → responder → devolver → aceitar)', () => {
    let pendenciaId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/pendencias')
        .set('Authorization', `Bearer ${gestorToken}`)
        .send(pendenciaBase());
      pendenciaId = res.body.id;
    });

    it('na criação: destinatarioId == responsavelId original', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pendencias/${pendenciaId}`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body.destinatarioId).toBe(seed.respId);
      expect(res.body.responsavelId).toBe(seed.respId);
      expect(res.body.auditorId).toBe(seed.gestorId);
    });

    it('após responder: responsavelId passa a ser auditorId; destinatarioId inalterado', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/responder`)
        .set('Authorization', `Bearer ${respToken}`)
        .send({ texto: 'Documentação enviada conforme solicitado.' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/pendencias/${pendenciaId}`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body.status).toBe('respondida');
      expect(res.body.responsavelId).toBe(seed.gestorId);  // auditorId assumiu
      expect(res.body.destinatarioId).toBe(seed.respId);   // imutável
    });

    it('após devolver: responsavelId volta ao destinatarioId original', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/devolver`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ motivoDevolucao: 'Documentação incompleta', novoPrazo: '2027-12-31' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/pendencias/${pendenciaId}`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body.status).toBe('aguardando_resposta');
      expect(res.body.responsavelId).toBe(seed.respId);    // voltou ao destinatário
      expect(res.body.destinatarioId).toBe(seed.respId);   // continua imutável
    });

    it('após segunda resposta + aceitar: encerrada e destinatarioId intacto', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/responder`)
        .set('Authorization', `Bearer ${respToken}`)
        .send({ texto: 'Docs revisados e reenviados.' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/pendencias/${pendenciaId}/aceitar`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/pendencias/${pendenciaId}`)
        .set('Authorization', `Bearer ${gestorToken}`)
        .expect(200);

      expect(res.body.status).toBe('encerrada');
      expect(res.body.destinatarioId).toBe(seed.respId);   // imutável até o fim
    });
  });
});
