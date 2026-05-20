import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LogoutDto {
  @ApiPropertyOptional({ description: 'Refresh token para invalidação imediata' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
