import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../database/prisma.service';
import { IniciativaStatus, PendenciaStatus } from '@prisma/client';
import { addDays } from 'date-fns';

jest.mock('../../common/context/tenant-context', () => ({
  requireTenantId: jest.fn().mockReturnValue('tenant-id'),
}));

const mockPrisma = {
  contrato: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  pendencia: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  iniciativa: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockCache = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
    mockCache.get.mockResolvedValue(null); // sem cache por padrão
  });

  describe('getResumo', () => {
    beforeEach(() => {
      mockPrisma.contrato.findMany.mockResolvedValue([
        {
          id: 'c-1',
          numero: 'CTR-001',
          objeto: 'Serviços de TI',
          dataTermino: addDays(new Date(), 20),
          responsavel: { id: 'r-1', nome: 'Responsável' },
          fornecedor: { id: 'f-1', nome: 'Fornecedor' },
        },
      ]);
      mockPrisma.pendencia.findMany.mockResolvedValue([
        {
          id: 'p-1',
          titulo: 'Pendência 1',
          origem: 'auditoria_interna',
          status: PendenciaStatus.aguardando_resposta,
          prazoResposta: addDays(new Date(), 5),
          responsavel: { id: 'r-1', nome: 'Responsável' },
        },
      ]);
      mockPrisma.iniciativa.findMany.mockResolvedValue([
        {
          id: 'i-1',
          titulo: 'Iniciativa Crítica',
          prioridade: 'alta',
          status: IniciativaStatus.em_andamento,
          dataLimite: addDays(new Date(), 3),
          responsavel: { id: 'r-1', nome: 'Responsável' },
        },
      ]);
    });

    it('deve retornar resumo do dashboard com todas as seções', async () => {
      const result = await service.getResumo('user-id', 'GESTOR');

      expect(result).toHaveProperty('contratos');
      expect(result).toHaveProperty('pendencias');
      expect(result).toHaveProperty('iniciativas');
      expect(result).toHaveProperty('geradoEm');
    });

    it('deve retornar resultado cacheado quando disponível', async () => {
      const cached = { contratos: {}, pendencias: {}, iniciativas: {}, geradoEm: new Date() };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getResumo('user-id', 'GESTOR');

      expect(result).toBe(cached);
      expect(mockPrisma.contrato.findMany).not.toHaveBeenCalled();
    });

    it('deve armazenar resultado no cache após consulta', async () => {
      await service.getResumo('user-id', 'ADMIN');

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('dashboard:'),
        expect.any(Object),
        60,
      );
    });

    it('deve filtrar contratos por responsável quando role é RESP', async () => {
      await service.getResumo('user-id', 'RESP');

      expect(mockPrisma.contrato.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ responsavelId: 'user-id' }),
        }),
      );
    });

    it('deve retornar contratos vazios para AUD_EXT', async () => {
      const result = await service.getResumo('user-id', 'AUD_EXT');

      expect(result.contratos.items).toHaveLength(0);
    });

    it('deve calcular semáforo dos contratos no dashboard', async () => {
      const result = await service.getResumo('user-id', 'GESTOR');

      // Contrato com 20 dias restantes → amarelo
      expect(result.contratos.items[0].semaforo).toBe('amarelo');
    });

    it('deve calcular semáforo vermelho para pendência com <= 7 dias', async () => {
      const result = await service.getResumo('user-id', 'GESTOR');

      // Pendência com 5 dias restantes → vermelho, urgente=true
      expect(result.pendencias.items[0].semaforo).toBe('vermelho');
      expect(result.pendencias.items[0].urgente).toBe(true);
    });

    it('deve filtrar apenas contratos com até 90 dias para vencer', async () => {
      mockPrisma.contrato.findMany.mockResolvedValue([
        {
          id: 'c-longe',
          numero: 'CTR-100',
          objeto: 'Objeto',
          dataTermino: addDays(new Date(), 120), // fora do filtro
          responsavel: { id: 'r-1', nome: 'R' },
          fornecedor: { id: 'f-1', nome: 'F' },
        },
      ]);

      const result = await service.getResumo('user-id', 'GESTOR');
      expect(result.contratos.items).toHaveLength(0);
    });
  });

  describe('getMetricas', () => {
    it('deve retornar null para perfis sem acesso (RESP)', async () => {
      const result = await service.getMetricas('RESP');
      expect(result).toBeNull();
    });

    it('deve retornar null para perfis sem acesso (AUD_EXT)', async () => {
      const result = await service.getMetricas('AUD_EXT');
      expect(result).toBeNull();
    });

    it('deve retornar métricas para ADMIN', async () => {
      mockPrisma.$transaction.mockResolvedValue([100, 75, 50, 5, 30]);

      const result = await service.getMetricas('ADMIN');

      expect(result).toHaveProperty('contratos');
      expect(result).toHaveProperty('pendencias');
      expect(result).toHaveProperty('iniciativas');
      expect(result.contratos.total).toBe(100);
      expect(result.contratos.vigentes).toBe(75);
    });

    it('deve retornar métricas cacheadas quando disponível', async () => {
      const cached = { contratos: { total: 50 }, geradoEm: new Date() };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getMetricas('GESTOR');

      expect(result).toBe(cached);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('deve armazenar métricas no cache por 120 segundos', async () => {
      mockPrisma.$transaction.mockResolvedValue([10, 8, 5, 1, 3]);

      await service.getMetricas('EXEC');

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('metricas:'),
        expect.any(Object),
        120,
      );
    });
  });
});
