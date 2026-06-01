import { IsOptional, IsString, IsDateString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TipoObrigacao, FinalidadeObrigacao, StatusProcessamento } from '../enums/obrigacao-acessoria.enums';

export class QueryObrigacaoDto {
  @ApiPropertyOptional({ example: '12345678000199' })
  @IsOptional()
  @IsString()
  cnpj?: string;

  @ApiPropertyOptional({ enum: TipoObrigacao })
  @IsOptional()
  @IsEnum(TipoObrigacao)
  tipoObrigacao?: TipoObrigacao;

  @ApiPropertyOptional({ enum: StatusProcessamento })
  @IsOptional()
  @IsEnum(StatusProcessamento)
  statusProcessamento?: StatusProcessamento;

  @ApiPropertyOptional({ enum: FinalidadeObrigacao })
  @IsOptional()
  @IsEnum(FinalidadeObrigacao)
  finalidade?: FinalidadeObrigacao;

  /** Filtra obrigações cujo período contenha esta data (data_inicial <= dataRef <= data_final) */
  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional()
  @IsDateString()
  dataRef?: string;

  /** Filtra obrigações cujo dataInicial >= este valor */
  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional()
  @IsDateString()
  dataInicial?: string;

  /** Filtra obrigações cujo dataFinal <= este valor */
  @ApiPropertyOptional({ example: '2025-03-31' })
  @IsOptional()
  @IsDateString()
  dataFinal?: string;

  /**
   * Se true, retorna apenas a versão mais recente de cada obrigação.
   * Se false, retorna todas as versões (original + retificações).
   * Se omitido, retorna todas as versões.
   */
  @ApiPropertyOptional()
  @IsOptional()
  versaoAtual?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Alias de limit — conveniente para o frontend */
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
