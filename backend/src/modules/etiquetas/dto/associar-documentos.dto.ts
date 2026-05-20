import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class AssociarDocumentosDto {
  @ApiProperty({ type: [String], description: 'IDs dos documentos a atualizar' })
  @IsArray()
  @IsString({ each: true })
  documentoIds: string[];

  @ApiPropertyOptional({ type: [String], description: 'IDs de etiquetas a associar' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  adicionar?: string[];

  @ApiPropertyOptional({ type: [String], description: 'IDs de etiquetas a desassociar' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  remover?: string[];
}
