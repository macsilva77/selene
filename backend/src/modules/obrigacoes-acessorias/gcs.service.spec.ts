import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GcsService } from './gcs.service';
import { Readable } from 'stream';
import { createHash } from 'crypto';

// ─── Mock do @google-cloud/storage ───────────────────────────────────────────
const mockFile = {
  exists:          jest.fn(),
  createReadStream: jest.fn(),
};
const mockBucket  = { file: jest.fn().mockReturnValue(mockFile) };
const mockStorage = { bucket: jest.fn().mockReturnValue(mockBucket) };

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => mockStorage),
}));

function makeReadStream(content: string): Readable {
  return Readable.from([Buffer.from(content)]);
}

function sha256Of(content: string): string {
  return createHash('sha256').update(Buffer.from(content)).digest('hex');
}

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('GcsService (integração com GCS mockado)', () => {
  let gcsService: GcsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GcsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'gcs.projectId')  return 'test-project';
              if (key === 'gcs.bucketName') return 'default-bucket';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    gcsService = module.get<GcsService>(GcsService);
    jest.clearAllMocks();
  });

  describe('parseCaminho', () => {
    it('deve extrair bucket e filePath do caminho completo', () => {
      const result = gcsService.parseCaminho('fiscal-docs-selene-prod/cnpj=123/arquivo.sped');
      expect(result).toEqual({
        bucket:   'fiscal-docs-selene-prod',
        filePath: 'cnpj=123/arquivo.sped',
      });
    });

    it('deve usar bucketName padrão quando não há separador', () => {
      const result = gcsService.parseCaminho('arquivo.sped');
      expect(result).toEqual({
        bucket:   'default-bucket',
        filePath: 'arquivo.sped',
      });
    });
  });

  describe('verificarArquivo — arquivo existe', () => {
    it('deve retornar exists=true e sha256 calculado via stream', async () => {
      const content = 'conteúdo do arquivo SPED';
      mockFile.exists.mockResolvedValue([true]);
      mockFile.createReadStream.mockReturnValue(makeReadStream(content));

      const result = await gcsService.verificarArquivo('bucket/path/arquivo.sped');

      expect(result.exists).toBe(true);
      expect(result.sha256).toBe(sha256Of(content));
    });

    it('deve calcular SHA-256 correto para conteúdo binário', async () => {
      const content = Buffer.from([0x00, 0xff, 0xde, 0xad, 0xbe, 0xef]);
      const expectedHash = createHash('sha256').update(content).digest('hex');

      mockFile.exists.mockResolvedValue([true]);
      mockFile.createReadStream.mockReturnValue(Readable.from([content]));

      const result = await gcsService.verificarArquivo('bucket/path/bin.sped');
      expect(result.sha256).toBe(expectedHash);
    });

    it('deve calcular SHA-256 correto para stream de múltiplos chunks', async () => {
      const chunk1 = Buffer.from('parte1');
      const chunk2 = Buffer.from('parte2');
      const expectedHash = createHash('sha256')
        .update(Buffer.concat([chunk1, chunk2]))
        .digest('hex');

      mockFile.exists.mockResolvedValue([true]);
      mockFile.createReadStream.mockReturnValue(Readable.from([chunk1, chunk2]));

      const result = await gcsService.verificarArquivo('bucket/path/multi.sped');
      expect(result.sha256).toBe(expectedHash);
    });
  });

  describe('verificarArquivo — arquivo não existe', () => {
    it('deve retornar exists=false sem tentar calcular hash', async () => {
      mockFile.exists.mockResolvedValue([false]);

      const result = await gcsService.verificarArquivo('bucket/path/inexistente.sped');

      expect(result.exists).toBe(false);
      expect(result.sha256).toBeUndefined();
      expect(mockFile.createReadStream).not.toHaveBeenCalled();
    });
  });
});
