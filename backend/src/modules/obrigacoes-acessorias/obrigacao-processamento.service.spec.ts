import { Test, TestingModule } from '@nestjs/testing';
import { ObrigacaoProcessamentoService } from './obrigacao-processamento.service';
import { PrismaService } from '../../database/prisma.service';
import { GcsService } from './gcs.service';
import { StatusProcessamento, FinalidadeObrigacao, TipoObrigacao } from './enums/obrigacao-acessoria.enums';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const HASH_VALIDO = 'a'.repeat(64);
const ID_EVENTO   = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function makeObrigacao(overrides: Partial<{
  id: string; idEvento: string; cnpj: string; tipoObrigacao: string;
  dataInicial: Date; dataFinal: Date; finalidade: string; hash: string;
  caminhoBucket: string;
}> = {}) {
  return {
    id:            'rec-id',
    idEvento:      ID_EVENTO,
    cnpj:          '12345678000199',
    tipoObrigacao: TipoObrigacao.EFD_CONTRIBUICOES,
    dataInicial:   new Date('2025-01-01'),
    dataFinal:     new Date('2025-03-31'),
    finalidade:    FinalidadeObrigacao.ORIGINAL,
    hash:          HASH_VALIDO,
    caminhoBucket: 'fiscal-docs/cnpj=12345678000199/arquivo.sped',
    ...overrides,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────
const mockPrisma = {
  obrigacaoAcessoria: {
    findMany:  jest.fn(),
    findFirst: jest.fn(),
    update:    jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockGcs = {
  verificarArquivo: jest.fn(),
};

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('ObrigacaoProcessamentoService', () => {
  let service: ObrigacaoProcessamentoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObrigacaoProcessamentoService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GcsService,    useValue: mockGcs },
      ],
    }).compile();

    service = module.get<ObrigacaoProcessamentoService>(ObrigacaoProcessamentoService);
    jest.clearAllMocks();

    // Comportamento padrão da transação: executa o callback com o mesmo mock
    mockPrisma.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrisma.obrigacaoAcessoria) => Promise<unknown>) =>
        cb(mockPrisma as any),
    );
  });

  // ── Cenário: arquivo válido → Processado (novo registro, versão 1) ─────────
  describe('Cenário: Arquivo válido, novo registro', () => {
    it('deve atualizar para Processado com versao=1 e versaoAtual=true', async () => {
      mockGcs.verificarArquivo.mockResolvedValue({ exists: true, sha256: HASH_VALIDO });
      mockPrisma.obrigacaoAcessoria.findFirst.mockResolvedValue(null); // sem Processado anterior
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const obrigacao = makeObrigacao();
      const result = await service.processarUm(obrigacao);

      expect(result.statusFinal).toBe(StatusProcessamento.PROCESSADO);
      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: obrigacao.id },
          data:  expect.objectContaining({
            statusProcessamento: StatusProcessamento.PROCESSADO,
            versao:              1,
            versaoAtual:         true,
            obrigacaoPaiId:      null,
          }),
        }),
      );
    });
  });

  // ── Cenário: arquivo ausente no GCS ───────────────────────────────────────
  describe('Cenário: Arquivo ausente no GCS', () => {
    it('deve atualizar para Erro_Arquivo_Nao_Encontrado', async () => {
      mockGcs.verificarArquivo.mockResolvedValue({ exists: false });
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const result = await service.processarUm(makeObrigacao());

      expect(result.statusFinal).toBe(StatusProcessamento.ERRO_ARQUIVO_NAO_ENCONTRADO);
      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusProcessamento: StatusProcessamento.ERRO_ARQUIVO_NAO_ENCONTRADO,
          }),
        }),
      );
    });

    it('deve usar Erro_Arquivo_Nao_Encontrado quando GCS lança exceção', async () => {
      mockGcs.verificarArquivo.mockRejectedValue(new Error('timeout'));
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const result = await service.processarUm(makeObrigacao());
      expect(result.statusFinal).toBe(StatusProcessamento.ERRO_ARQUIVO_NAO_ENCONTRADO);
    });
  });

  // ── Cenário: hash divergente ───────────────────────────────────────────────
  describe('Cenário: Hash divergente', () => {
    it('deve atualizar para Erro_Hash_Divergente', async () => {
      mockGcs.verificarArquivo.mockResolvedValue({ exists: true, sha256: 'b'.repeat(64) });
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const result = await service.processarUm(makeObrigacao({ hash: 'a'.repeat(64) }));

      expect(result.statusFinal).toBe(StatusProcessamento.ERRO_HASH_DIVERGENTE);
      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusProcessamento: StatusProcessamento.ERRO_HASH_DIVERGENTE,
          }),
        }),
      );
    });

    it('deve comparar hash case-insensitive', async () => {
      // Hash retornado em maiúsculo pelo GCS, armazenado em minúsculo
      mockGcs.verificarArquivo.mockResolvedValue({ exists: true, sha256: HASH_VALIDO.toUpperCase() });
      mockPrisma.obrigacaoAcessoria.findFirst.mockResolvedValue(null);
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const result = await service.processarUm(makeObrigacao({ hash: HASH_VALIDO.toLowerCase() }));
      expect(result.statusFinal).toBe(StatusProcessamento.PROCESSADO);
    });
  });

  // ── Cenário: Retificação cria nova versão ─────────────────────────────────
  describe('Cenário: Retificação cria nova versão (RN-09)', () => {
    const processadoExistente = {
      id:              'orig-id',
      versao:          1,
      versaoAtual:     true,
      obrigacaoPaiId:  null,
      statusProcessamento: StatusProcessamento.PROCESSADO,
    };

    it('deve criar versão 2 e desativar versão 1', async () => {
      mockGcs.verificarArquivo.mockResolvedValue({ exists: true, sha256: HASH_VALIDO });
      mockPrisma.obrigacaoAcessoria.findFirst.mockResolvedValue(processadoExistente);
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const retificacao = makeObrigacao({
        id:        'ret-id',
        finalidade: FinalidadeObrigacao.RETIFICACAO,
      });
      const result = await service.processarUm(retificacao);

      expect(result.statusFinal).toBe(StatusProcessamento.PROCESSADO);

      // Versão anterior deve ser desativada
      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'orig-id' },
          data:  expect.objectContaining({ versaoAtual: false }),
        }),
      );

      // Novo registro deve ter versao=2, versaoAtual=true, obrigacaoPaiId=orig-id
      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ret-id' },
          data:  expect.objectContaining({
            statusProcessamento: StatusProcessamento.PROCESSADO,
            versao:              2,
            versaoAtual:         true,
            obrigacaoPaiId:      'orig-id',
          }),
        }),
      );
    });

    it('deve propagar obrigacaoPaiId original em múltiplas retificações', async () => {
      const v2 = { ...processadoExistente, id: 'ret-v2-id', versao: 2, obrigacaoPaiId: 'orig-id' };
      mockGcs.verificarArquivo.mockResolvedValue({ exists: true, sha256: HASH_VALIDO });
      mockPrisma.obrigacaoAcessoria.findFirst.mockResolvedValue(v2);
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const ret3 = makeObrigacao({ id: 'ret-v3-id', finalidade: FinalidadeObrigacao.RETIFICACAO });
      await service.processarUm(ret3);

      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ret-v3-id' },
          data:  expect.objectContaining({
            versao:         3,
            obrigacaoPaiId: 'orig-id', // mantém o pai raiz
          }),
        }),
      );
    });
  });

  // ── Cenário: Original duplicado → Erro_Duplicata_Original ─────────────────
  describe('Cenário: Original duplicado é rejeitado (RN-09)', () => {
    it('deve retornar Erro_Duplicata_Original sem alterar o original', async () => {
      const processadoExistente = {
        id: 'orig-id', versao: 1, versaoAtual: true, obrigacaoPaiId: null,
        statusProcessamento: StatusProcessamento.PROCESSADO,
      };
      mockGcs.verificarArquivo.mockResolvedValue({ exists: true, sha256: HASH_VALIDO });
      mockPrisma.obrigacaoAcessoria.findFirst.mockResolvedValue(processadoExistente);
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const duplicata = makeObrigacao({ id: 'dup-id', finalidade: FinalidadeObrigacao.ORIGINAL });
      const result = await service.processarUm(duplicata);

      expect(result.statusFinal).toBe(StatusProcessamento.ERRO_DUPLICATA_ORIGINAL);

      // O original NÃO deve ser alterado (apenas o duplicata recebe erro)
      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dup-id' },
          data:  expect.objectContaining({
            statusProcessamento: StatusProcessamento.ERRO_DUPLICATA_ORIGINAL,
          }),
        }),
      );
      expect(mockPrisma.obrigacaoAcessoria.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'orig-id' } }),
      );
    });
  });

  // ── processarPendentes: busca registros Recebido ──────────────────────────
  describe('processarPendentes', () => {
    it('deve chamar processarUm para cada registro Recebido', async () => {
      const obr1 = makeObrigacao({ id: 'id-1' });
      const obr2 = makeObrigacao({ id: 'id-2', idEvento: 'evt-2' });
      mockPrisma.obrigacaoAcessoria.findMany.mockResolvedValue([obr1, obr2]);
      mockGcs.verificarArquivo.mockResolvedValue({ exists: true, sha256: HASH_VALIDO });
      mockPrisma.obrigacaoAcessoria.findFirst.mockResolvedValue(null);
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const resultados = await service.processarPendentes();

      expect(resultados).toHaveLength(2);
      expect(mockPrisma.obrigacaoAcessoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { statusProcessamento: StatusProcessamento.RECEBIDO },
        }),
      );
    });

    it('deve retornar array vazio quando não há pendentes', async () => {
      mockPrisma.obrigacaoAcessoria.findMany.mockResolvedValue([]);
      const resultados = await service.processarPendentes();
      expect(resultados).toHaveLength(0);
    });
  });
});
