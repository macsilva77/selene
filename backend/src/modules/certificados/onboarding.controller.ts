import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CertificadoConvitesService } from './certificado-convites.service';
import { ValidarCertificadoDto } from './dto/validar-certificado.dto';

/**
 * Rotas PÚBLICAS de onboarding de certificado (sem autenticação).
 * Protegidas por token de uso único + rate limiting.
 */
@ApiTags('Onboarding de Certificado (público)')
@Public()
@Controller('onboarding/certificado')
export class OnboardingController {
  constructor(private readonly service: CertificadoConvitesService) {}

  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Validar o link de onboarding e retornar dados mínimos' })
  validar(@Param('token') token: string) {
    return this.service.validarTokenPublico(token);
  }

  @Post(':token')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = file.originalname.split('.').pop()?.toLowerCase();
        cb(null, ['pfx', 'p12'].includes(ext ?? ''));
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Enviar o certificado .pfx/.p12 e concluir o onboarding' })
  enviar(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ValidarCertificadoDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo não enviado ou formato inválido (.pfx/.p12).');
    }
    return this.service.consumirPublico(token, file.buffer, dto.password, req.ip ?? '');
  }
}
