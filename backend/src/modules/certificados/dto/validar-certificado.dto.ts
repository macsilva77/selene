import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ValidarCertificadoDto {
  @ApiProperty({ description: 'Senha do certificado .pfx/.p12' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
