import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateFornecedorDto } from './create-fornecedor.dto';

export class UpdateFornecedorDto extends PartialType(OmitType(CreateFornecedorDto, ['cnpj'] as const)) {}
