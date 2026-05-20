import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EtiquetasService } from './etiquetas.service';
import { CreateEtiquetaDto } from './dto/create-etiqueta.dto';
import { UpdateEtiquetaDto } from './dto/update-etiqueta.dto';
import { AssociarDocumentosDto } from './dto/associar-documentos.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Etiquetas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('etiquetas')
export class EtiquetasController {
  constructor(private readonly etiquetasService: EtiquetasService) {}

  @Get()
  @RequiresPermission('etiquetas.view')
  @ApiOperation({ summary: 'Listar etiquetas do tenant' })
  listar() {
    return this.etiquetasService.listar();
  }

  @Post()
  @RequiresPermission('etiquetas.create')
  @ApiOperation({ summary: 'Criar etiqueta' })
  criar(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: CreateEtiquetaDto,
  ) {
    return this.etiquetasService.criar({ usuarioId }, dto);
  }

  @Patch(':id')
  @RequiresPermission('etiquetas.edit')
  @ApiOperation({ summary: 'Atualizar etiqueta' })
  atualizar(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEtiquetaDto,
  ) {
    return this.etiquetasService.atualizar({ usuarioId }, id, dto);
  }

  @Delete(':id')
  @RequiresPermission('etiquetas.delete')
  @ApiOperation({ summary: 'Excluir etiqueta (soft delete — bloqueado se associada a documentos)' })
  remover(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.etiquetasService.remover({ usuarioId }, id);
  }

  @Post('documentos/associar')
  @RequiresPermission('etiquetas.edit')
  @ApiOperation({ summary: 'Associar/desassociar etiquetas em documentos (bulk, transacional)' })
  associarDocumentos(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: AssociarDocumentosDto,
  ) {
    return this.etiquetasService.atualizarDocumentoEtiquetas({ usuarioId }, dto);
  }

  @Get('historico/:documentoId')
  @RequiresPermission('etiquetas.view')
  @ApiOperation({ summary: 'Histórico imutável de alterações de etiquetas de um documento' })
  historicoDocumento(@Param('documentoId') documentoId: string) {
    return this.etiquetasService.listarHistorico(documentoId);
  }
}
