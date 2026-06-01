import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { TipoObrigacao, FinalidadeObrigacao } from '../enums/obrigacao-acessoria.enums';

/**
 * DTO que mapeia o contrato JSON publicado no tópico Pub/Sub.
 * Os campos seguem o PascalCase definido pelo publicador externo.
 */
export class ObrigacaoEventoDto {
  @IsUUID()
  IdEvento!: string;

  @IsEnum(TipoObrigacao)
  TipoObrigacao!: TipoObrigacao;

  /** 14 dígitos sem formatação */
  @IsString()
  @Length(14, 14)
  CNPJ!: string;

  /** RN-04: obrigatório somente para EFD_ICMS_IPI */
  @ValidateIf((o: ObrigacaoEventoDto) => o.TipoObrigacao === TipoObrigacao.EFD_ICMS_IPI)
  @IsString()
  @Length(1, 20)
  InscricaoEstadual?: string;

  @IsISO8601({ strict: true })
  DataInicial!: string;

  @IsISO8601({ strict: true })
  DataFinal!: string;

  @IsEnum(FinalidadeObrigacao)
  Finalidade!: FinalidadeObrigacao;

  /** SHA-256 em hexadecimal (64 chars) */
  @IsString()
  @Length(64, 64)
  Hash!: string;

  @IsISO8601()
  DataEntrega!: string;

  @IsString()
  NomeArquivo!: string;

  @IsString()
  CaminhoBucket!: string;

  /** Informativo do publicador — ignorado para status interno */
  @IsOptional()
  @IsString()
  SituacaoProcessamento?: string;
}
