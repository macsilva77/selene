import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoUnidade } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateUnidadeDto {
  @ApiProperty({ example: 'Diretoria de Contratos', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nome: string;

  @ApiPropertyOptional({ example: 'DIRC', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sigla?: string;

  @ApiProperty({ enum: TipoUnidade, example: 'UG' })
  @IsEnum(TipoUnidade)
  tipo: TipoUnidade;

  @ApiPropertyOptional({ description: 'ID do usuário responsável (Diretor)' })
  @IsOptional()
  @IsUUID()
  responsavelId?: string;

  @ApiPropertyOptional({ description: 'ID da unidade pai (para hierarquia)' })
  @IsOptional()
  @IsUUID()
  paiId?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  dataVigenciaInicio?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  dataVigenciaFim?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
