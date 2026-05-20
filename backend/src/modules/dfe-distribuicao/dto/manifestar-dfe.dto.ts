import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { TipoEventoManifestacaoCodigo } from '../dfe.types';

export class ManifestarDfeDto {
  @IsUUID()
  documentoId: string;

  @IsIn(['210200', '210210', '210220', '210240'])
  tpEvento: TipoEventoManifestacaoCodigo;

  @IsOptional()
  @IsString()
  @MinLength(15)
  xJust?: string;
}
