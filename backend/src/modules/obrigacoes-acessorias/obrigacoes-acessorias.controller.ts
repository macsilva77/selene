import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ObrigacoesAcessoriasService } from './obrigacoes-acessorias.service';
import { QueryObrigacaoDto } from './dto/query-obrigacao.dto';
import { UploadObrigacaoDto } from './dto/upload-obrigacao.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';

@ApiTags('Obrigações Acessórias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('obrigacoes-acessorias')
export class ObrigacoesAcessoriasController {
  constructor(private readonly service: ObrigacoesAcessoriasService) {}

  @Get()
  @RequiresPermission('obrigacoes-acessorias.view')
  @ApiOperation({ summary: 'Listar obrigações acessórias com filtros e paginação' })
  listar(@Query() query: QueryObrigacaoDto) {
    return this.service.listar(query);
  }

  @Post('upload')
  @RequiresPermission('obrigacoes-acessorias.view')
  @ApiOperation({ summary: 'Upload manual de arquivo de obrigação acessória (RN-12)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['tipoObrigacao', 'cnpj', 'dataInicial', 'dataFinal', 'finalidade', 'arquivo'],
      properties: {
        tipoObrigacao:     { type: 'string', enum: ['EFD_ICMS_IPI', 'EFD_CONTRIBUICOES', 'ECD', 'ECF'] },
        cnpj:              { type: 'string', example: '12345678000199' },
        inscricaoEstadual: { type: 'string' },
        dataInicial:       { type: 'string', format: 'date' },
        dataFinal:         { type: 'string', format: 'date' },
        finalidade:        { type: 'string', enum: ['Original', 'Retificacao'] },
        arquivo:           { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 500 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadObrigacaoDto,
  ) {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    if (!file.originalname.toLowerCase().endsWith('.txt')) {
      throw new BadRequestException('Somente arquivos .txt são aceitos');
    }
    return this.service.uploadManual(dto, file.buffer, file.originalname);
  }

  @Get('dashboard')
  @RequiresPermission('obrigacoes-acessorias.view')
  @ApiOperation({ summary: 'Dashboard: contagem por tipo e status de processamento' })
  dashboard() {
    return this.service.dashboard();
  }

  @Get('historico')
  @RequiresPermission('obrigacoes-acessorias.view')
  @ApiOperation({ summary: 'Histórico de versões (original + retificações) por CNPJ/tipo/período' })
  historico(
    @Query('cnpj')          cnpj: string,
    @Query('tipoObrigacao') tipoObrigacao: string,
    @Query('dataInicial')   dataInicial: string,
    @Query('dataFinal')     dataFinal: string,
  ) {
    return this.service.historico(cnpj, tipoObrigacao, dataInicial, dataFinal);
  }

  @Get(':id/download-url')
  @RequiresPermission('obrigacoes-acessorias.view')
  @ApiOperation({ summary: 'Gera URL pré-assinada para download do arquivo (RN-15 — 15 min)' })
  gerarDownloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.gerarDownloadUrl(id);
  }

  @Get(':id/download')
  @RequiresPermission('obrigacoes-acessorias.view')
  @ApiOperation({ summary: 'Download do arquivo via proxy — sem necessidade de Signed URL' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, nomeArquivo } = await this.service.downloadArquivo(id);
    res.set({
      'Content-Type':        'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(nomeArquivo)}"`,
    });
    return new StreamableFile(stream);
  }
}
