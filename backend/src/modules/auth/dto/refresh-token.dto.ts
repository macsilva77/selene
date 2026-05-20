import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiPropertyOptional({ description: 'Omitir quando usar cookie httpOnly' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
