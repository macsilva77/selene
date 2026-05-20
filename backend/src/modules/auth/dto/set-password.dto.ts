import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SENHA_REGEX, SENHA_MSG } from './create-user.dto';

export class SetPasswordDto {
  @ApiProperty({ description: 'Token recebido por e-mail' })
  @IsString()
  token: string;

  @ApiProperty({ description: SENHA_MSG })
  @IsString()
  @Matches(SENHA_REGEX, { message: SENHA_MSG })
  novaSenha: string;
}
