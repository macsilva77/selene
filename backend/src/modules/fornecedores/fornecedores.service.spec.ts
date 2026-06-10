import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FornecedoresService } from './fornecedores.service';
import { FornecedorRepository } from './fornecedor.repository';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { BrasilApiService } from '../../common/brasil-api/brasil-api.service';
import { AuditAcao } from '@prisma/client';

jest.mock('../../common/context/tenant-context', () => ({
  requireTenantId: jest.fn().mockReturnValue('tenant-id'),
}));

const mockRepo = {
  findByCnpj:           jest.fn(),
  create:               jest.fn(),
  findMany:             jest.fn(),
  findByIdWithCount:    jest.fn(),
  update:               jest.fn(),
  countContratosAtivos: jest.fn(),
  withTransaction:      jest.fn(),
  softDeleteTx:         jest.fn(),
  findByCnpjFormatado:  jest.fn(),
};

const mockAuditoria = { gravar: jest.fn() };
const mockBrasilApi = { buscarCnpj: jest.fn() };

const fornecedorMock = {
  id: 'forn-id',
  nome: 'Empresa Teste LTDA',
  cnpj: '12.345.678/0001-90',
  email: 'contato@empresa.com',
  telefone: '(11) 98765-4321',
  ativo: true,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
  _count: { contratos: 2 },
};

describe('FornecedoresService', () => {
  let service: FornecedoresService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FornecedoresService,
        { provide: FornecedorRepository, useValue: mockRepo },
        { provide: AuditoriaService,     useValue: mockAuditoria },
        { provide: BrasilApiService,     useValue: mockBrasilApi },
      ],
    }).compile();

    service = module.get<FornecedoresService>(FornecedoresService);
    jest.clearAllMocks();
  });

  describe('criar', () => {
    const dto = {
      nome: 'Empresa Teste LTDA',
      cnpj: '12.345.678/0001-90',
      email: 'contato@empresa.com',
      telefone: '(11) 98765-4321',
    };

    it('deve criar fornecedor com sucesso', async () => {
      mockRepo.findByCnpj.mockResolvedValue(null);
      mockRepo.create.mockResolvedValue(fornecedorMock);

      const result = await service.criar(dto, 'user-id');

      expect(result).toBeDefined();
      expect(result.cnpj).toBe(dto.cnpj);
      expect(mockRepo.create).toHaveBeenCalledTimes(1);
      expect(mockAuditoria.gravar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: AuditAcao.CREATE }),
      );
    });

    it('deve lançar ConflictException quando CNPJ já está cadastrado', async () => {
      mockRepo.findByCnpj.mockResolvedValue(fornecedorMock);

      await expect(service.criar(dto, 'user-id')).rejects.toThrow(ConflictException);
      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('listar', () => {
    it('deve retornar fornecedores paginados', async () => {
      mockRepo.findMany.mockResolvedValue([[fornecedorMock], 1]);

      const result = await service.listar({});

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('deve filtrar por ativo=true', async () => {
      mockRepo.findMany.mockResolvedValue([[fornecedorMock], 1]);

      await service.listar({ ativo: true });

      expect(mockRepo.findMany).toHaveBeenCalledTimes(1);
    });

    it('deve aplicar paginação corretamente', async () => {
      mockRepo.findMany.mockResolvedValue([[], 50]);

      const result = await service.listar({ page: 2, limit: 10 });

      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.totalPages).toBe(5);
    });

    it('deve buscar por nome ou CNPJ quando search é fornecido', async () => {
      mockRepo.findMany.mockResolvedValue([[fornecedorMock], 1]);

      await service.listar({ search: 'Empresa' });

      expect(mockRepo.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('buscarPorId', () => {
    it('deve retornar fornecedor existente', async () => {
      mockRepo.findByIdWithCount.mockResolvedValue(fornecedorMock);

      const result = await service.buscarPorId('forn-id');
      expect(result).toBeDefined();
      expect(result.id).toBe('forn-id');
    });

    it('deve lançar NotFoundException quando fornecedor não existe', async () => {
      mockRepo.findByIdWithCount.mockResolvedValue(null);
      await expect(service.buscarPorId('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('atualizar', () => {
    it('deve atualizar fornecedor com sucesso', async () => {
      mockRepo.findByIdWithCount.mockResolvedValue(fornecedorMock);
      mockRepo.update.mockResolvedValue({ ...fornecedorMock, telefone: '(11) 11111-1111' });

      const result = await service.atualizar('forn-id', { telefone: '(11) 11111-1111' }, 'user-id');

      expect(result.telefone).toBe('(11) 11111-1111');
      expect(mockAuditoria.gravar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: AuditAcao.UPDATE }),
      );
    });

    it('deve lançar NotFoundException quando fornecedor não existe', async () => {
      mockRepo.findByIdWithCount.mockResolvedValue(null);
      await expect(service.atualizar('inexistente', { nome: 'Novo' }, 'user-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('inativar', () => {
    it('deve inativar fornecedor com sucesso', async () => {
      const mockTx = { auditLog: { create: jest.fn() }, fornecedor: { update: jest.fn() } };
      mockRepo.findByIdWithCount.mockResolvedValue(fornecedorMock);
      mockRepo.countContratosAtivos.mockResolvedValue(0);
      mockRepo.withTransaction.mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));

      const result = await service.inativar('forn-id', 'user-id');

      expect(result).toHaveProperty('message');
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ acao: AuditAcao.INATIVAR }),
        }),
      );
    });

    it('deve lançar ConflictException quando fornecedor já está inativo', async () => {
      mockRepo.findByIdWithCount.mockResolvedValue({ ...fornecedorMock, ativo: false });

      await expect(service.inativar('forn-id', 'user-id')).rejects.toThrow(ConflictException);
    });

    it('deve lançar ConflictException quando há contratos ativos vinculados', async () => {
      mockRepo.findByIdWithCount.mockResolvedValue(fornecedorMock);
      mockRepo.countContratosAtivos.mockResolvedValue(2);

      await expect(service.inativar('forn-id', 'user-id')).rejects.toThrow(ConflictException);
      expect(mockRepo.withTransaction).not.toHaveBeenCalled();
    });

    it('deve lançar NotFoundException quando fornecedor não existe', async () => {
      mockRepo.findByIdWithCount.mockResolvedValue(null);
      await expect(service.inativar('inexistente', 'user-id')).rejects.toThrow(NotFoundException);
    });
  });
});
