import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  Length,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TipoObrigacao,
  FinalidadeObrigacao,
} from '../enums/obrigacao-acessoria.enums';

/**
 * DTO para upload manual de obrigação acessória (multipart/form-data).
 * RN-12: Origem é definida pelo sistema como Upload_Manual — não editável pelo usuário.
 */
export class UploadObrigacaoDto {
  @ApiProperty({ enum: TipoObrigacao })
  @IsEnum(TipoObrigacao)
  tipoObrigacao!: TipoObrigacao;

  @ApiProperty({ example: '12345678000199' })
  @IsString()
  @Length(14, 14)
  cnpj!: string;

  /** RN-04: obrigatório apenas para EFD_ICMS_IPI */
  @ApiPropertyOptional({ example: '123456789' })
  @ValidateIf((o: UploadObrigacaoDto) => o.tipoObrigacao === TipoObrigacao.EFD_ICMS_IPI)
  @IsString()
  @Length(1, 20)
  inscricaoEstadual?: string;

  @ApiProperty({ example: '2025-01-01' })
  @IsDateString()
  dataInicial!: string;

  @ApiProperty({ example: '2025-03-31' })
  @IsDateString()
  dataFinal!: string;

  @ApiProperty({ enum: FinalidadeObrigacao })
  @IsEnum(FinalidadeObrigacao)
  finalidade!: FinalidadeObrigacao;

  @ApiPropertyOptional({ description: 'Campo somente-leitura — ignorado se enviado' })
  @IsOptional()
  @IsString()
  origem?: never;
}
