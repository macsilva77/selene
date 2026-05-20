import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class ConfigurarDfeDto {
  /** CNPJ monitorado — 14 caracteres alfanuméricos sem máscara. Deve estar cadastrado em Empresas. */
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value.replace(/[.\-\/\s]/g, '').toUpperCase();
  })
  @Matches(/^[A-Z0-9]{14}$/, { message: 'CNPJ deve ter exatamente 14 caracteres alfanuméricos' })
  cnpj: string;

  /**
   * Ambiente de consulta:
   *  1 = Produção (NF-es reais)
   *  2 = Homologação (dados de teste)
   */
  @IsIn([1, 2], { message: 'tpAmb deve ser 1 (produção) ou 2 (homologação)' })
  tpAmb: 1 | 2;

  /** UUID do CertificadoDigital a ser usado para mTLS */
  @IsUUID()
  certificadoId: string;

  /**
   * Horário de início da captura no formato HH:MM (ex: "08:00").
   * A captura não será executada antes desse horário em cada dia.
   */
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horarioCaptura deve estar no formato HH:MM' })
  horarioCaptura: string;

  /**
   * Intervalo em minutos entre execuções (mínimo 5, máximo 1440 = 24h).
   * Ex: 60 = a cada hora; 30 = a cada 30 minutos.
   */
  @IsInt()
  @Min(5, { message: 'intervaloMinutos mínimo é 5' })
  @Max(1440, { message: 'intervaloMinutos máximo é 1440 (24h)' })
  intervaloMinutos: number;
}
