import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class ConfigurarNfseDto {
  /** CNPJ monitorado — 14 caracteres sem máscara. Deve estar cadastrado em Empresas. */
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[.\-/\s]/g, '').toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{14}$/, { message: 'CNPJ deve ter exatamente 14 caracteres' })
  cnpj: string;

  /** 1 = Produção; 2 = Produção Restrita (homologação/testes) */
  @IsIn([1, 2], { message: 'tpAmb deve ser 1 (produção) ou 2 (produção restrita)' })
  tpAmb: 1 | 2;

  /** UUID do CertificadoDigital usado no mTLS */
  @IsUUID()
  certificadoId: string;

  /**
   * URL base do ADN Contribuintes. Opcional — se omitida, usa o padrão do ambiente
   * (produção restrita ou produção).
   */
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'baseUrl inválida' })
  baseUrl?: string;

  /** Horário de início da captura "HH:MM" (ex: "08:00"). */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horarioCaptura deve estar no formato HH:MM' })
  horarioCaptura?: string;

  /** Intervalo em minutos entre execuções (mín. 60 por causa da regra de consumo indevido). */
  @IsOptional()
  @IsInt()
  @Min(60, { message: 'intervaloMinutos mínimo é 60 (regra de 1h do ADN)' })
  @Max(1440, { message: 'intervaloMinutos máximo é 1440 (24h)' })
  intervaloMinutos?: number;
}
