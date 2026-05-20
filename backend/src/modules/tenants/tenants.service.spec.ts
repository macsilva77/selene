import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../../database/prisma.service';
import { PlanoTenant } from '@prisma/client';

const mockPrisma = {
  tenant: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

const tenantMock = {
  id: 'tenant-id',
  nome: 'Prefeitura Teste',
  slug: 'prefeitura-teste',
  cnpj: '12.345.678/0001-90',
  plano: PlanoTenant.starter,
  ativo: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  _count: { usuarios: 5, contratos: 10 },
};

describe('TenantsService', () => {
  let service: TenantsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    jest.clearAllMocks();
  });

  describe('criar', () => {
    const dto = {
      nome: 'Prefeitura Teste',
      slug: 'prefeitura-teste',
      cnpj: '12.345.678/0001-90',
      plano: PlanoTenant.starter,
    };

    it('deve criar tenant com sucesso', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.create.mockResolvedValue(tenantMock);

      const result = await service.criar(dto);

      expect(result).toBeDefined();
      expect(result.slug).toBe(dto.slug);
      expect(mockPrisma.tenant.create).toHaveBeenCalledTimes(1);
    });

    it('deve lançar ConflictException quando slug já está em uso', async () => {
      // findUnique é chamado primeiro para slug, retorna tenant existente
      mockPrisma.tenant.findUnique.mockResolvedValue(tenantMock);

      await expect(service.criar(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.tenant.create).not.toHaveBeenCalled();
    });

    it('deve lançar ConflictException quando CNPJ já está cadastrado', async () => {
      // primeira chamada (slug) retorna null, segunda (cnpj) retorna tenant existente
      mockPrisma.tenant.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(tenantMock);

      await expect(service.criar(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.tenant.create).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('deve retornar tenants paginados com metadados', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([tenantMock]);
      mockPrisma.tenant.count.mockResolvedValue(1);

      const result = await service.listar(1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('deve calcular skip corretamente para paginação', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([]);
      mockPrisma.tenant.count.mockResolvedValue(50);

      const result = await service.listar(3, 10);

      expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta.totalPages).toBe(5);
    });
  });

  describe('buscarPorId', () => {
    it('deve retornar tenant existente', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(tenantMock);

      const result = await service.buscarPorId('tenant-id');
      expect(result.id).toBe('tenant-id');
    });

    it('deve lançar NotFoundException quando tenant não existe', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.buscarPorId('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('buscarPorSlug', () => {
    it('deve retornar tenant pelo slug', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(tenantMock);

      const result = await service.buscarPorSlug('prefeitura-teste');
      expect(result.slug).toBe('prefeitura-teste');
    });

    it('deve lançar NotFoundException quando slug não existe', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.buscarPorSlug('nao-existe')).rejects.toThrow(NotFoundException);
    });
  });

  describe('atualizar', () => {
    it('deve atualizar tenant com sucesso', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(tenantMock);
      mockPrisma.tenant.update.mockResolvedValue({ ...tenantMock, nome: 'Novo Nome' });

      const result = await service.atualizar('tenant-id', { nome: 'Novo Nome' });

      expect(result.nome).toBe('Novo Nome');
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'tenant-id' } }),
      );
    });

    it('deve lançar NotFoundException quando tenant não existe', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.atualizar('inexistente', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspender', () => {
    it('deve suspender tenant com sucesso', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(tenantMock);
      mockPrisma.tenant.update.mockResolvedValue({ ...tenantMock, ativo: false });

      const result = await service.suspender('tenant-id');

      expect(result.ativo).toBe(false);
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ativo: false } }),
      );
    });
  });

  describe('reativar', () => {
    it('deve reativar tenant com sucesso', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ ...tenantMock, ativo: false });
      mockPrisma.tenant.update.mockResolvedValue(tenantMock);

      const result = await service.reativar('tenant-id');

      expect(result.ativo).toBe(true);
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ativo: true } }),
      );
    });
  });
});
