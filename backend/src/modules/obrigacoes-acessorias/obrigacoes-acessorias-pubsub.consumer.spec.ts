import { Test, TestingModule } from '@nestjs/testing';
import { ObrigacoesAcessoriasService } from './obrigacoes-acessorias.service';
import { ObrigacoesAcessoriasPubSubConsumer } from './obrigacoes-acessorias-pubsub.consumer';
import { PrismaService } from '../../database/prisma.service';
import { GcsService } from './gcs.service';
import { ConfigService } from '@nestjs/config';
import { StatusProcessamento, TipoObrigacao, FinalidadeObrigacao } from './enums/obrigacao-acessoria.enums';

// ─── Mock do cliente Pub/Sub ──────────────────────────────────────────────────
const mockSubscription = {
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@google-cloud/pubsub', () => ({
  PubSub: jest.fn().mockImplementation(() => ({
    subscription: jest.fn().mockReturnValue(mockSubscription),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ─── Mock do Prisma ───────────────────────────────────────────────────────────
const mockPrisma = {
  obrigacaoAcessoria: {
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    findMany:   jest.fn(),
    count:      jest.fn(),
    groupBy:    jest.fn(),
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const HASH = 'a'.repeat(64);

const payloadValido = (): Record<string, unknown> => ({
  IdEvento:      UUID,
  TipoObrigacao: TipoObrigacao.EFD_CONTRIBUICOES,
  CNPJ:          '12345678000199',
  DataInicial:   '2025-01-01',
  DataFinal:     '2025-03-31',
  Finalidade:    FinalidadeObrigacao.ORIGINAL,
  Hash:          HASH,
  DataEntrega:   '2025-04-10T10:00:00Z',
  NomeArquivo:   'arquivo.sped',
  CaminhoBucket: 'bucket/path/arquivo.sped',
});

function makeMsgMock(data: Record<string, unknown> | string | null): {
  data: Buffer;
  ack: jest.Mock;
  nack: jest.Mock;
} {
  const raw = data === null ? 'não é json {{{' : JSON.stringify(data);
  return {
    data: Buffer.from(raw),
    ack:  jest.fn(),
    nack: jest.fn(),
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('ObrigacoesAcessoriasPubSubConsumer', () => {
  let consumer: ObrigacoesAcessoriasPubSubConsumer;
  let _service: ObrigacoesAcessoriasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObrigacoesAcessoriasService,
        ObrigacoesAcessoriasPubSubConsumer,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: GcsService,     useValue: { verificarArquivo: jest.fn(), gerarSignedUrl: jest.fn(), uploadBuffer: jest.fn(), getDefaultBucket: () => 'test-bucket' } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'pubsub.projectId')                     return 'test-project';
              if (key === 'pubsub.subscriptionObrigacaoRecebida') return 'test-sub';
              if (key === 'gcs.bucketName')                       return 'test-bucket';
              if (key === 'gcs.projectId')                        return 'test-project';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    consumer = module.get<ObrigacoesAcessoriasPubSubConsumer>(ObrigacoesAcessoriasPubSubConsumer);
    _service = module.get<ObrigacoesAcessoriasService>(ObrigacoesAcessoriasService);
    jest.clearAllMocks();
  });

  // ── Cenário: mensagem válida ─────────────────────────────────────────────
  describe('Cenário: Mensagem válida é persistida como Recebido', () => {
    it('deve criar registro com status Recebido e fazer ack', async () => {
      mockPrisma.obrigacaoAcessoria.findUnique.mockResolvedValue(null);
      mockPrisma.obrigacaoAcessoria.create.mockResolvedValue({ id: 'novo-id' });

      const msg = makeMsgMock(payloadValido());
      await consumer.handleMessage(msg as any);

      expect(mockPrisma.obrigacaoAcessoria.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusProcessamento: StatusProcessamento.RECEBIDO,
            origem:              'Topico',
            atualizadoPor:       'pubsub-consumer',
          }),
        }),
      );
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.nack).not.toHaveBeenCalled();
    });

    it('deve preencher data_recebimento_evento com timestamp atual', async () => {
      mockPrisma.obrigacaoAcessoria.findUnique.mockResolvedValue(null);
      mockPrisma.obrigacaoAcessoria.create.mockResolvedValue({ id: 'novo-id' });

      const antes = new Date();
      const msg = makeMsgMock(payloadValido());
      await consumer.handleMessage(msg as any);
      const depois = new Date();

      const chamada = mockPrisma.obrigacaoAcessoria.create.mock.calls[0][0] as any;
      const dataRecebimento: Date = chamada.data.dataRecebimentoEvento;
      expect(dataRecebimento.getTime()).toBeGreaterThanOrEqual(antes.getTime());
      expect(dataRecebimento.getTime()).toBeLessThanOrEqual(depois.getTime());
    });
  });

  // ── Cenário: CNPJ ausente → Erro_Validacao ───────────────────────────────
  describe('Cenário: Mensagem sem CNPJ gera Erro_Validacao', () => {
    it('deve persistir Erro_Validacao e fazer ack (nunca nack)', async () => {
      mockPrisma.obrigacaoAcessoria.findUnique.mockResolvedValue(null);
      mockPrisma.obrigacaoAcessoria.create.mockResolvedValue({ id: 'err-id' });

      const { CNPJ: _removed, ...semCnpj } = payloadValido() as any;
      const msg = makeMsgMock(semCnpj);
      await consumer.handleMessage(msg as any);

      expect(mockPrisma.obrigacaoAcessoria.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusProcessamento: StatusProcessamento.ERRO_VALIDACAO,
          }),
        }),
      );
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.nack).not.toHaveBeenCalled();
    });
  });

  // ── Cenário: RN-04 — EFD_ICMS_IPI sem IE ─────────────────────────────────
  describe('Cenário: EFD_ICMS_IPI sem InscricaoEstadual gera Erro_Validacao', () => {
    it('deve persistir Erro_Validacao para EFD_ICMS_IPI sem IE', async () => {
      mockPrisma.obrigacaoAcessoria.findUnique.mockResolvedValue(null);
      mockPrisma.obrigacaoAcessoria.create.mockResolvedValue({ id: 'err-ie' });

      const msg = makeMsgMock({
        ...payloadValido(),
        TipoObrigacao: TipoObrigacao.EFD_ICMS_IPI,
        // InscricaoEstadual ausente intencionalmente
      });
      await consumer.handleMessage(msg as any);

      expect(mockPrisma.obrigacaoAcessoria.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            statusProcessamento: StatusProcessamento.ERRO_VALIDACAO,
          }),
        }),
      );
      expect(msg.ack).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cenário: RN-08 — idEvento já Processado → ignorar ────────────────────
  describe('Cenário: IdEvento já Processado é ignorado (RN-08)', () => {
    it('deve fazer ack sem alterar o banco', async () => {
      mockPrisma.obrigacaoAcessoria.findUnique.mockResolvedValue({
        id: 'exist-id',
        statusProcessamento: StatusProcessamento.PROCESSADO,
      });

      const msg = makeMsgMock(payloadValido());
      await consumer.handleMessage(msg as any);

      expect(mockPrisma.obrigacaoAcessoria.create).not.toHaveBeenCalled();
      expect(mockPrisma.obrigacaoAcessoria.update).not.toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cenário: RN-08 — idEvento em Erro pode ser reprocessado ──────────────
  describe('Cenário: IdEvento em Erro pode ser reprocessado (RN-08)', () => {
    it('deve atualizar o registro para Recebido', async () => {
      mockPrisma.obrigacaoAcessoria.findUnique.mockResolvedValue({
        id: 'exist-id',
        statusProcessamento: StatusProcessamento.ERRO_VALIDACAO,
      });
      mockPrisma.obrigacaoAcessoria.update.mockResolvedValue({});

      const msg = makeMsgMock(payloadValido());
      await consumer.handleMessage(msg as any);

      expect(mockPrisma.obrigacaoAcessoria.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exist-id' },
          data:  expect.objectContaining({
            statusProcessamento: StatusProcessamento.RECEBIDO,
            atualizadoPor:       'pubsub-consumer',
          }),
        }),
      );
      expect(mockPrisma.obrigacaoAcessoria.create).not.toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cenário: JSON inválido ────────────────────────────────────────────────
  describe('Cenário: JSON inválido', () => {
    it('deve fazer ack sem tentar persistir (evita loop)', async () => {
      const msg = makeMsgMock(null);
      await consumer.handleMessage(msg as any);

      expect(mockPrisma.obrigacaoAcessoria.create).not.toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.nack).not.toHaveBeenCalled();
    });
  });

  // ── Cenário: falha de banco → nack ────────────────────────────────────────
  describe('Cenário: falha inesperada de banco → nack para retry', () => {
    it('deve fazer nack quando o banco lança erro inesperado', async () => {
      mockPrisma.obrigacaoAcessoria.findUnique.mockRejectedValue(new Error('DB offline'));

      const msg = makeMsgMock(payloadValido());
      await consumer.handleMessage(msg as any);

      expect(msg.nack).toHaveBeenCalledTimes(1);
      expect(msg.ack).not.toHaveBeenCalled();
    });
  });
});
