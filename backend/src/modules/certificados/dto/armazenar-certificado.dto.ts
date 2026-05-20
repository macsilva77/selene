import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProcuracaoDto {
  @IsString() @IsNotEmpty() cnpjOutorgante: string;
  @IsString() @IsNotEmpty() cpfCnpjOutorgado: string;
  @IsString() @IsNotEmpty() nomeOutorgado: string;
  @IsString() @MinLength(10) poderesDelegados: string;
  @IsDateString() dataInicio: string;
  @IsDateString() dataValidade: string;
}

export class ArmazenarCertificadoDto {
  @ApiProperty({ description: 'ID do certificado criado na etapa de validação' })
  @IsUUID()
  certificadoId: string;

  @ApiProperty({ type: [String], description: 'IDs das empresas a associar' })
  @IsArray()
  @IsUUID('4', { each: true })
  empresaIds: string[];

  @ApiPropertyOptional({ type: ProcuracaoDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProcuracaoDto)
  procuracao?: ProcuracaoDto | null;
}
