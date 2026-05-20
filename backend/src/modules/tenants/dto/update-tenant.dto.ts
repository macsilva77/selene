import { PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateTenantDto } from './create-tenant.dto';

export class UpdateTenantDto extends PartialType(OmitType(CreateTenantDto, ['slug'] as const)) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @ApiPropertyOptional({ description: 'Nome do Diretor Responsável (Res. CMN 4.968/2021, Art. 10)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  diretorNome?: string;

  @ApiPropertyOptional({ description: 'Cargo do Diretor Responsável' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  diretorCargo?: string;

  @ApiPropertyOptional({ description: 'E-mail do Diretor Responsável' })
  @IsOptional()
  @IsEmail()
  diretorEmail?: string;

  @ApiPropertyOptional({ description: 'Data da designação formal', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  diretorDesignadoEm?: string;
}
