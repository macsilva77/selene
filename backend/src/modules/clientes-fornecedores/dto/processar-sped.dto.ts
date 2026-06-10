import { IsString, IsInt, IsNotEmpty, IsUUID, Matches, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ProcessarSpedDto {
  @IsString()
  @IsNotEmpty()
  evento: string;

  @IsUUID()
  tenantId: string;

  @IsUUID()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  cnpj: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  ano: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;

  /** URI GCS da EFD ICMS/IPI — fonte primária de blocos C e D. */
  @IsString()
  @IsNotEmpty()
  @Matches(/^gs:\/\//, { message: 'spedIcmsIpiGcsUri deve ser um URI GCS válido (gs://)' })
  spedIcmsIpiGcsUri: string;

  /**
   * URI GCS da EFD Contribuições — sempre obrigatória.
   * Usada para Bloco A (serviços ISS). Blocos C e D ignorados quando
   * há EFD ICMS/IPI (regra: ICMS/IPI é fonte exclusiva de C e D).
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^gs:\/\//, { message: 'spedContribGcsUri deve ser um URI GCS válido (gs://)' })
  spedContribGcsUri: string;
}
