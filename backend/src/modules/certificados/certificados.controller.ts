import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { CertificadoStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CertificadosService } from './certificados.service';
import { ValidarCertificadoDto } from './dto/validar-certificado.dto';
import { ArmazenarCertificadoDto } from './dto/armazenar-certificado.dto';

@ApiTags('Certificados Digitais A1')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('certificados')
export class CertificadosController {
  constructor(private readonly service: CertificadosService) {}

  // ── POST /certificados/validar ───────────────────────────────────────────────

  @Post('validar')
  @RequiresPermission('certificados.create')
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
  @ApiOperation({ summary: 'Validar e extrair dados do certificado .pfx/.p12 (UC-CERT-001 Passo 1)' })
  validar(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ValidarCertificadoDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
    @Req() req: Request,
  ) {
    return this.service.validar(file, dto.password, tenantId, usuarioId, req.ip ?? '');
  }

  // ── GET /certificados/empresas/:raizCnpj ────────────────────────────────────

  @Get('empresas/:raizCnpj')
  @RequiresPermission('certificados.view')
  @ApiOperation({ summary: 'Listar empresas do tenant com a mesma raiz CNPJ (UC-CERT-001 Passo 3)' })
  buscarEmpresasPorRaiz(@Param('raizCnpj') raizCnpj: string) {
    return this.service.buscarEmpresasPorRaiz(raizCnpj);
  }

  // ── GET /certificados ────────────────────────────────────────────────────────

  @Get()
  @RequiresPermission('certificados.view')
  @ApiOperation({ summary: 'Listar todos os certificados do tenant' })
  listar(
    @Query('status') status?: CertificadoStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listar({
      status,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ── POST /certificados ───────────────────────────────────────────────────────

  @Post()
  @RequiresPermission('certificados.create')
  @ApiOperation({ summary: 'Finalizar armazenamento do certificado com associações (UC-CERT-001 Passo 5)' })
  armazenar(
    @Body() dto: ArmazenarCertificadoDto,
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') usuarioId: string,
    @Req() req: Request,
  ) {
    return this.service.armazenar(dto, tenantId, usuarioId, req.ip ?? '');
  }

  // ── GET /certificados/:id ────────────────────────────────────────────────────

  @Get(':id')
  @RequiresPermission('certificados.view')
  @ApiOperation({ summary: 'Buscar certificado por ID com associações e procuração' })
  buscarPorId(@Param('id') id: string) {
    return this.service.buscarPorId(id);
  }

  // ── PATCH /certificados/:id/revogar ─────────────────────────────────────────

  @Patch(':id/revogar')
  @RequiresPermission('certificados.delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revogar/inativar certificado digital' })
  revogar(
    @Param('id') id: string,
    @CurrentUser('sub') usuarioId: string,
    @Req() req: Request,
  ) {
    return this.service.revogar(id, usuarioId, req.ip ?? '');
  }

  // ── GET /certificados/:id/logs ───────────────────────────────────────────────

  @Get(':id/logs')
  @RequiresPermission('certificados.view')
  @ApiOperation({ summary: 'Listar logs de auditoria do certificado' })
  buscarLogs(@Param('id') id: string) {
    return this.service.buscarLogs(id);
  }
}
