import { Test, TestingModule } from '@nestjs/testing';
import { PerfisController } from './perfis.controller';
import { PerfisService } from './perfis.service';

// Mock PerfisService
const mockPerfisService = {
  listar: jest.fn(),
  criar: jest.fn(),
  // Adicione outros métodos mockados conforme necessário
};

describe('PerfisController', () => {
  let controller: PerfisController;
  let service: PerfisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PerfisController],
      providers: [
        { provide: PerfisService, useValue: mockPerfisService },
      ],
    }).compile();

    controller = module.get<PerfisController>(PerfisController);
    service = module.get<PerfisService>(PerfisService);
  });

  it('deve ser definido', () => {
    expect(controller).toBeDefined();
  });

  it('deve listar perfis', async () => {
    mockPerfisService.listar.mockResolvedValue(['perfil1', 'perfil2']);
    const result = await controller.listar();
    expect(result).toEqual(['perfil1', 'perfil2']);
    expect(mockPerfisService.listar).toHaveBeenCalledWith();
  });

  it('deve listar perfis ativos', async () => {
    mockPerfisService.listar.mockResolvedValue(['perfilAtivo']);
    const result = await controller.listarAtivos();
    expect(result).toEqual(['perfilAtivo']);
    expect(mockPerfisService.listar).toHaveBeenCalledWith(true);
  });

  it('deve criar perfil', async () => {
    const dto = { nome: 'Novo Perfil' };
    mockPerfisService.criar.mockResolvedValue({ id: '1', ...dto });
    const result = await controller.criar('user1', dto as any);
    expect(result).toEqual({ id: '1', ...dto });
    expect(mockPerfisService.criar).toHaveBeenCalledWith({ usuarioId: 'user1' }, dto);
  });
});
