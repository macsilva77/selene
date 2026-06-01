import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ObrigacaoEventoDto } from '../dto/obrigacao-evento.dto';
import { TipoObrigacao, FinalidadeObrigacao } from '../enums/obrigacao-acessoria.enums';

/** Payload mínimo válido para reutilizar nos testes */
const payloadValido = () => ({
  IdEvento:       'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  TipoObrigacao:  TipoObrigacao.EFD_CONTRIBUICOES,
  CNPJ:           '12345678000199',
  DataInicial:    '2025-01-01',
  DataFinal:      '2025-03-31',
  Finalidade:     FinalidadeObrigacao.ORIGINAL,
  Hash:           'a'.repeat(64),
  DataEntrega:    '2025-04-10T10:00:00Z',
  NomeArquivo:    'EFD_CONTRIB_01_2025.sped',
  CaminhoBucket:  'fiscal-docs-selene-prod/cnpj=12345678000199/EFD_CONTRIB_01_2025.sped',
});

function toDto(raw: Record<string, unknown>): ObrigacaoEventoDto {
  return plainToInstance(ObrigacaoEventoDto, raw);
}

describe('ObrigacaoEventoDto — validação', () => {
  describe('Payload válido', () => {
    it('deve passar sem erros para EFD_CONTRIBUICOES', async () => {
      const dto = toDto(payloadValido());
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('deve passar para EFD_ICMS_IPI com InscricaoEstadual', async () => {
      const dto = toDto({
        ...payloadValido(),
        TipoObrigacao: TipoObrigacao.EFD_ICMS_IPI,
        InscricaoEstadual: '123456789',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('deve aceitar campo SituacaoProcessamento opcional', async () => {
      const dto = toDto({ ...payloadValido(), SituacaoProcessamento: 'Concluido' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('RN-03 — TipoObrigacao inválido', () => {
    it('deve reprovar valor desconhecido em TipoObrigacao', async () => {
      const dto = toDto({ ...payloadValido(), TipoObrigacao: 'EFD_INVALIDO' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'TipoObrigacao')).toBe(true);
    });
  });

  describe('RN-04 — InscricaoEstadual obrigatória para EFD_ICMS_IPI', () => {
    it('deve reprovar EFD_ICMS_IPI sem InscricaoEstadual', async () => {
      const dto = toDto({
        ...payloadValido(),
        TipoObrigacao: TipoObrigacao.EFD_ICMS_IPI,
        // InscricaoEstadual ausente
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'InscricaoEstadual')).toBe(true);
    });

    it('deve aprovar outros tipos sem InscricaoEstadual', async () => {
      for (const tipo of [TipoObrigacao.ECD, TipoObrigacao.ECF, TipoObrigacao.EFD_CONTRIBUICOES]) {
        const dto = toDto({ ...payloadValido(), TipoObrigacao: tipo });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'InscricaoEstadual')).toBe(false);
      }
    });
  });

  describe('Campos obrigatórios ausentes', () => {
    it('deve reprovar quando CNPJ está ausente', async () => {
      const { CNPJ: _removed, ...rest } = payloadValido();
      const dto = toDto(rest);
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'CNPJ')).toBe(true);
    });

    it('deve reprovar quando IdEvento não é UUID', async () => {
      const dto = toDto({ ...payloadValido(), IdEvento: 'nao-e-uuid' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'IdEvento')).toBe(true);
    });

    it('deve reprovar CNPJ com comprimento diferente de 14', async () => {
      const dto = toDto({ ...payloadValido(), CNPJ: '123' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'CNPJ')).toBe(true);
    });

    it('deve reprovar Hash com comprimento diferente de 64', async () => {
      const dto = toDto({ ...payloadValido(), Hash: 'abc' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'Hash')).toBe(true);
    });

    it('deve reprovar DataInicial com formato inválido', async () => {
      const dto = toDto({ ...payloadValido(), DataInicial: '01/01/2025' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'DataInicial')).toBe(true);
    });

    it('deve reprovar Finalidade com valor inválido', async () => {
      const dto = toDto({ ...payloadValido(), Finalidade: 'Substituicao' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'Finalidade')).toBe(true);
    });
  });
});
