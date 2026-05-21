import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'gestor@selene.gov.br' })
  @IsEmail({}, { message: 'E-mail inválido' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'SenhaSuperForte@123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Senha deve ter no mínimo 6 caracteres' })
  senha: string;

  @ApiPropertyOptional({ example: 'selene-default', description: 'Slug do tenant (obrigatório em ambientes multi-tenant)' })
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}
