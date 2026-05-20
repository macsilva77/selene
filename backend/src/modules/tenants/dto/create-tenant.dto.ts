import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanoTenant } from '@prisma/client';

export class CreateTenantDto {
  @ApiProperty({ example: 'Banco XYZ S.A.' })
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @MaxLength(200)
  nome: string;

  @ApiProperty({ example: 'banco-xyz', description: 'Slug único para subdomínio (lowercase, hífens)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug deve conter apenas letras minúsculas, números e hífens' })
  @MaxLength(63)
  slug: string;

  @ApiPropertyOptional({ example: '12.345.678/0001-99' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ inválido (XX.XXX.XXX/XXXX-XX)' })
  cnpj?: string;

  @ApiPropertyOptional({ enum: PlanoTenant, default: PlanoTenant.free })
  @IsOptional()
  @IsEnum(PlanoTenant)
  plano?: PlanoTenant = PlanoTenant.free;
}
