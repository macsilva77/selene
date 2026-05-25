import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmpresaDto {
  @ApiProperty({ description: 'Razão Social' })
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  nome: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nomeFantasia?: string;

  @ApiProperty({ example: '45684942000174', description: 'CNPJ — 14 caracteres alfanuméricos, sem pontuação' })
  @IsString()
  @IsNotEmpty({ message: 'CNPJ é obrigatório' })
  @Transform(({ value }: { value: unknown }) => {
    // Remove pontuação (./- e espaços) mantendo letras e números
    if (typeof value !== 'string') return value;
    return value.replace(/[.\-/\s]/g, '').toUpperCase();
  })
  @Matches(/^[A-Z0-9]{14}$/, { message: 'CNPJ deve ter exatamente 14 caracteres alfanuméricos' })
  cnpj: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  cep?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logradouro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  numero?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  complemento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bairro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  municipio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  uf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inscricaoEstadual?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inscricaoMunicipal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  regimeTributario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipoEstabelecimento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnaePrincipal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cnaeSecundario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quadroSocietario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  situacaoCadastral?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  naturezaJuridica?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dataInicioAtividade?: string;
}
