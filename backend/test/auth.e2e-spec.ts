import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { cleanDatabase, createTestApp, seedE2eTenant } from './helpers/app.helper';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let tenantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const seed = await seedE2eTenant(app);
    tenantId = seed.tenantId;
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  describe('POST /api/v1/auth/login', () => {
    it('deve autenticar com credenciais válidas e retornar tokens + tenantId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@e2e.test', senha: 'Senha@123456' })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toHaveProperty('tenantId', tenantId);
      expect(res.body.user).toHaveProperty('role', 'ADMIN');
    });

    it('deve retornar 401 com senha incorreta', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@e2e.test', senha: 'senha-errada' })
        .expect(401);
    });

    it('deve retornar 401 com e-mail inexistente', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'naoexiste@e2e.test', senha: 'Senha@123456' })
        .expect(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let accessToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@e2e.test', senha: 'Senha@123456' });
      accessToken = res.body.accessToken;
    });

    it('deve retornar dados do usuário autenticado', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('sub', 'e2e-admin-id');
      expect(res.body).toHaveProperty('role', 'ADMIN');
      expect(res.body).toHaveProperty('tenantId', tenantId);
    });

    it('deve retornar 401 sem token', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('deve renovar access token com refresh token válido', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'gestor@e2e.test', senha: 'Senha@123456' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('deve retornar 401 com refresh token inválido', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'token-invalido' })
        .expect(401);
    });
  });
});
