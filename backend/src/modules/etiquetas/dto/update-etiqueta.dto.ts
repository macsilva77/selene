import { PartialType } from '@nestjs/swagger';
import { CreateEtiquetaDto } from './create-etiqueta.dto';

export class UpdateEtiquetaDto extends PartialType(CreateEtiquetaDto) {}
