import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEtiquetaDto {
  @ApiProperty({ example: 'Urgente', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nome: string;

  @ApiProperty({ example: '#EF4444', description: 'Cor em hexadecimal (#RRGGBB)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Cor deve estar no formato hexadecimal #RRGGBB' })
  cor: string;

  @ApiPropertyOptional({ default: false, description: 'Define como etiqueta padrão (troca atômica)' })
  @IsOptional()
  @IsBoolean()
  padrao?: boolean;
}
