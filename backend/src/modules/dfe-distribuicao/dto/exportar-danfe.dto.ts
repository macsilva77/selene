import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsUUID } from 'class-validator';

export class ExportarDanfeDto {
  @ApiProperty({ description: 'IDs dos documentos DFe (procNFe) para exportar', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  documentoIds: string[];

  @ApiPropertyOptional({ description: 'E-mail para receber o ZIP com os DANFEs gerados' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
