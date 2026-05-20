import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTenantDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  nome?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  @Matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ inválido (formato: XX.XXX.XXX/XXXX-XX)' })
  cnpj?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  nomeFantasia?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20)
  telefone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(9)
  cep?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255)
  logradouro?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10)
  numero?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  complemento?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  bairro?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  municipio?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2)
  uf?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  cnaePrincipal?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  inscricaoEstadual?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  inscricaoMunicipal?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  regimeTributario?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  situacaoCadastral?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150)
  tipoEstabelecimento?: string;

}
