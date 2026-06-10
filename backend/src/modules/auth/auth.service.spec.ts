import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthenticationService } from './authentication.service';
import { UserManagementService } from './user-management.service';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { AppConfigService } from '../../config/app-config.service';

jest.mock('../../common/context/tenant-context', () => ({
  requireTenantId: jest.fn().mockReturnValue('tenant-id'),
}));

jest.mock('bcrypt');

const mockMailService = {
  enviarBoasVindas: jest.fn().mockResolvedValue(undefined),
};

const mockBlacklist = {
  blacklist: jest.fn().mockResolvedValue(undefined),
  isBlacklisted: jest.fn().mockResolvedValue(false),
  trackFailedLogin: jest.fn().mockResolvedValue(undefined),
  isLoginLocked: jest.fn().mockResolvedValue(false),
  clearLoginFailures: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  usuario: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  perfil: { findFirst: jest.fn() },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
};

const mockJwt = {
  signAsync: jest.fn().mockResolvedValue('mock-token'),
  verify: jest.fn(),
};

const mockAppConfig = {
  jwt: {
    secret:           'test-secret',
    expiresIn:        '8h',
    refreshSecret:    'test-refresh',
    refreshExpiresIn: '30d',
  },
  frontendUrl:   'https://app.test',
  isProduction:  false,
};

describe('AuthenticationService', () => {
  let service: AuthenticationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthenticationService,
        { provide: PrismaService,        useValue: mockPrisma },
        { provide: JwtService,           useValue: mockJwt },
        { provide: AppConfigService,     useValue: mockAppConfig },
        { provide: TokenBlacklistService, useValue: mockBlacklist },
      ],
    }).compile();

    service = module.get<AuthenticationService>(AuthenticationService);
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('deve retornar tokens ao fazer login com credenciais válidas', async () => {
      const usuario = {
        id: 'user-id', nome: 'Admin', email: 'admin@test.com', role: 'ADMIN',
        ativo: true, senhaHash: 'hash', tenantId: 'tenant-id',
        tenant: { id: 'tenant-id', slug: 'test', ativo: true, plano: 'free' },
        perfis: [],
      };
      mockPrisma.usuario.findFirst.mockResolvedValue(usuario);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ email: 'admin@test.com', senha: 'senha' }, '127.0.0.1', 'test-agent');

      expect(result.accessToken).toBe('mock-token');
      expect(result.user.email).toBe('admin@test.com');
    });

    it('deve lançar UnauthorizedException com credenciais inválidas', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      await expect(
        service.login({ email: 'wrong@test.com', senha: 'wrong' }, '127.0.0.1', 'agent'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('deve lançar UnauthorizedException com senha incorreta', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue({
        id: 'id', ativo: true, senhaHash: 'hash', tenantId: 'tenant-id',
        tenant: { id: 'tenant-id', slug: 'test', ativo: true, plano: 'free' },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'user@test.com', senha: 'errada' }, '127.0.0.1', 'agent'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

describe('UserManagementService', () => {
  let service: UserManagementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserManagementService,
        { provide: PrismaService,    useValue: mockPrisma },
        { provide: AppConfigService, useValue: mockAppConfig },
        { provide: MailService,      useValue: mockMailService },
      ],
    }).compile();

    service = module.get<UserManagementService>(UserManagementService);
    jest.clearAllMocks();
  });

  describe('criarUsuario', () => {
    it('deve criar usuário com sucesso', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue(null);
      mockPrisma.perfil.findFirst.mockResolvedValue({ id: 'perfil-id', role: 'GESTOR' });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
      mockPrisma.usuario.create.mockResolvedValue({
        id: 'new-id', nome: 'Novo', email: 'novo@test.com', role: 'GESTOR', tenantId: 'tenant-id', criadoEm: new Date(),
      });

      const result = await service.criarUsuario({ nome: 'Novo', email: 'novo@test.com', perfilId: 'perfil-id' });
      expect(result.email).toBe('novo@test.com');
    });

    it('deve lançar ConflictException para email duplicado', async () => {
      mockPrisma.usuario.findFirst.mockResolvedValue({ id: 'existente', ativo: true });
      await expect(
        service.criarUsuario({ nome: 'Novo', email: 'existente@test.com', perfilId: 'perfil-id' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
