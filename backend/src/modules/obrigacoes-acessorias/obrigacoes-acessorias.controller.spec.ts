import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ObrigacoesAcessoriasController } from './obrigacoes-acessorias.controller';
import { ObrigacoesAcessoriasService } from './obrigacoes-acessorias.service';
import { TipoObrigacao, FinalidadeObrigacao } from './enums/obrigacao-acessoria.enums';
import { UploadObrigacaoDto } from './dto/upload-obrigacao.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

// ─── Mock do serviço ──────────────────────────────────────────────────────────
const mockService = {
  listar:           jest.fn(),
  dashboard:        jest.fn(),
  historico:        jest.fn(),
  uploadManual:     jest.fn(),
  gerarDownloadUrl: jest.fn(),
};

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('ObrigacoesAcessoriasController', () => {
  let controller: ObrigacoesAcessoriasController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObrigacoesAcessoriasController],
      providers: [
        { provide: ObrigacoesAcessoriasService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ObrigacoesAcessoriasController>(ObrigacoesAcessoriasController);
    jest.clearAllMocks();
  });

  // ── GET / ─────────────────────────────────────────────────────────────────
  describe('GET /obrigacoes-acessorias', () => {
    it('deve chamar service.listar com os query params', async () => {
      const expected = { total: 0, page: 1, limit: 20, totalPages: 0, items: [] };
      mockService.listar.mockResolvedValue(expected);

      const result = await controller.listar({ tipoObrigacao: TipoObrigacao.ECD, page: 1 });
      expect(mockService.listar).toHaveBeenCalledWith({ tipoObrigacao: TipoObrigacao.ECD, page: 1 });
      expect(result).toBe(expected);
    });
  });

  // ── POST /upload ──────────────────────────────────────────────────────────
  describe('POST /obrigacoes-acessorias/upload', () => {
    const dto: UploadObrigacaoDto = {
      tipoObrigacao: TipoObrigacao.EFD_CONTRIBUICOES,
      cnpj:          '12345678000199',
      dataInicial:   '2025-01-01',
      dataFinal:     '2025-03-31',
      finalidade:    FinalidadeObrigacao.ORIGINAL,
    };

    const mockFile = {
      originalname: 'arquivo.txt',
      buffer:       Buffer.from('conteudo'),
      mimetype:     'text/plain',
    } as Express.Multer.File;

    it('deve chamar service.uploadManual e retornar id', async () => {
      mockService.uploadManual.mockResolvedValue({ id: 'rec-uuid' });

      const result = await controller.upload(mockFile, dto);

      expect(mockService.uploadManual).toHaveBeenCalledWith(dto, mockFile.buffer, 'arquivo.txt');
      expect(result).toEqual({ id: 'rec-uuid' });
    });

    it('deve lançar BadRequestException se arquivo não for enviado', async () => {
      await expect(controller.upload(undefined as any, dto)).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException se extensão não for .txt', async () => {
      const xmlFile = { ...mockFile, originalname: 'arquivo.xml' } as Express.Multer.File;
      await expect(controller.upload(xmlFile, dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ── GET /:id/download-url ─────────────────────────────────────────────────
  describe('GET /obrigacoes-acessorias/:id/download-url', () => {
    it('deve retornar url e expiresAt', async () => {
      const expected = { url: 'https://storage.googleapis.com/signed...', expiresAt: '2026-06-01T00:15:00.000Z' };
      mockService.gerarDownloadUrl.mockResolvedValue(expected);

      const result = await controller.gerarDownloadUrl('f47ac10b-58cc-4372-a567-0e02b2c3d479');
      expect(mockService.gerarDownloadUrl).toHaveBeenCalledWith('f47ac10b-58cc-4372-a567-0e02b2c3d479');
      expect(result).toBe(expected);
    });

    it('deve propagar NotFoundException do serviço', async () => {
      mockService.gerarDownloadUrl.mockRejectedValue(new NotFoundException());
      await expect(
        controller.gerarDownloadUrl('f47ac10b-58cc-4372-a567-0e02b2c3d479'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── GET /dashboard ────────────────────────────────────────────────────────
  describe('GET /obrigacoes-acessorias/dashboard', () => {
    it('deve delegar ao service.dashboard', async () => {
      mockService.dashboard.mockResolvedValue([]);
      await controller.dashboard();
      expect(mockService.dashboard).toHaveBeenCalledTimes(1);
    });
  });

  // ── GET /historico ────────────────────────────────────────────────────────
  describe('GET /obrigacoes-acessorias/historico', () => {
    it('deve chamar service.historico com os parâmetros corretos', async () => {
      mockService.historico.mockResolvedValue([]);
      await controller.historico('12345678000199', 'ECD', '2025-01-01', '2025-12-31');
      expect(mockService.historico).toHaveBeenCalledWith(
        '12345678000199', 'ECD', '2025-01-01', '2025-12-31',
      );
    });
  });
});
