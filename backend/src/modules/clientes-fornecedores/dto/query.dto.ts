import { IsString, IsNotEmpty, IsInt, IsIn, IsOptional, Min, Max, Length, Matches } from 'class-validator';
import { Type } from 'class-transformer';

/** Parâmetros de período + empresa comuns a todos os endpoints analíticos. */
export class QueryPeriodoDto {
  /** CNPJ da empresa (14 dígitos numéricos, sem formatação). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{14}$/, { message: 'cnpj deve conter exatamente 14 dígitos numéricos' })
  cnpj: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anoInicio: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mesInicio: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anoFim: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mesFim: number;

  @IsIn(['CLIENTE', 'FORNECEDOR'])
  tipo: 'CLIENTE' | 'FORNECEDOR';
}

/** Ranking completo ou Top N (topN omitido = sem limite). */
export class QueryRankingDto extends QueryPeriodoDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  topN?: number;
}

/** Busca pelo CNPJ de um participante específico no ranking global. */
export class QueryPorCnpjDto extends QueryPeriodoDto {
  /** CNPJ do participante (8–14 dígitos numéricos: raiz, base ou completo). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{8,14}$/, { message: 'cnpjParticipante deve conter entre 8 e 14 dígitos numéricos' })
  cnpjParticipante: string;
}

/** Drill-down dos CNPJs de um grupo econômico. */
export class QueryDrillDownDto extends QueryPeriodoDto {
  /** Raiz do CNPJ do grupo econômico (8 dígitos). */
  @IsString()
  @IsNotEmpty()
  @Length(8, 8)
  cnpjRaiz: string;
}
