import { Test, TestingModule } from '@nestjs/testing';
import { AuditoriaService } from './auditoria.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditAcao } from '@prisma/client';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
};

const logMock = {
  id: BigInt(1),
  correlationId: 'corr-id',
  usuarioId: 'user-id',
  entidadeTipo: 'contrato',
  entidadeId: 'contrato-id',
  acao: AuditAcao.CREATE,
  payloadAntes: null,
  payloadDepois: { numero: 'CTR-001' },
  ipOrigem: '127.0.0.1',
  userAgent: 'jest',
  criadoEm: new Date(),
};

describe('AuditoriaService', () => {
  let service: AuditoriaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditoriaService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditoriaService>(AuditoriaService);
    jest.clearAllMocks();
  });

  describe('gravar', () => {
    it('deve gravar log de auditoria com sucesso', async () => {
      mockPrisma.auditLog.create.mockResolvedValue(logMock);

      const result = await service.gravar({
        usuarioId: 'user-id',
        entidadeTipo: 'contrato',
        entidadeId: 'contrato-id',
        acao: AuditAcao.CREATE,
        payloadDepois: { numero: 'CTR-001' },
      });

      expect(result).toBeDefined();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('deve aceitar correlationId opcional', async () => {
      mockPrisma.auditLog.create.mockResolvedValue(logMock);

      await service.gravar({
        correlationId: 'corr-xyz',
        usuarioId: 'user-id',
        entidadeTipo: 'pendencia',
        entidadeId: 'pend-id',
        acao: AuditAcao.STATUS_CHANGE,
        payloadAntes: { status: 'aguardando_resposta' },
        payloadDepois: { status: 'respondida' },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ correlationId: 'corr-xyz' }),
        }),
      );
    });

    it('deve aceitar log sem usuarioId (ações de sistema)', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({ ...logMock, usuarioId: null });

      const result = await service.gravar({
        entidadeTipo: 'processo_licitatorio',
        entidadeId: 'proc-id',
        acao: AuditAcao.CREATE,
        payloadDepois: { geradoAutomaticamente: true },
      });

      expect(result).toBeDefined();
    });
  });

  describe('buscar', () => {
    it('deve retornar logs paginados', async () => {
      mockPrisma.$transaction.mockResolvedValue([[logMock], 1]);

      const result = await service.buscar({ entidadeTipo: 'contrato' });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('deve aplicar filtro por entidadeTipo e entidadeId', async () => {
      mockPrisma.$transaction.mockResolvedValue([[logMock], 1]);

      await service.buscar({ entidadeTipo: 'contrato', entidadeId: 'contrato-id' });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('deve aplicar filtro por intervalo de datas', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.buscar({
        dataInicio: new Date('2026-01-01'),
        dataFim: new Date('2026-12-31'),
      });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('deve aplicar filtro por ação', async () => {
      mockPrisma.$transaction.mockResolvedValue([[logMock], 1]);

      const result = await service.buscar({ acao: AuditAcao.LOGIN });

      expect(result.data).toHaveLength(1);
    });

    it('deve calcular totalPages corretamente', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 55]);

      const result = await service.buscar({ page: 2, limit: 10 });

      expect(result.meta.totalPages).toBe(6);
      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
    });

    it('deve retornar lista vazia quando não há logs', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.buscar({});

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });
});
