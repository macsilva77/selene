import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UnidadesOrganizacionaisService } from './unidades-organizacionais.service';
import { CreateUnidadeDto } from './dto/create-unidade.dto';
import { UpdateUnidadeDto } from './dto/update-unidade.dto';

@ApiTags('Unidades Organizacionais')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('unidades-organizacionais')
export class UnidadesOrganizacionaisController {
  constructor(private readonly service: UnidadesOrganizacionaisService) {}

  @Get()
  @RequiresPermission('unidades.view')
  @ApiOperation({ summary: 'Listar todas as unidades do tenant' })
  @ApiQuery({ name: 'apenasAtivas', required: false, type: Boolean })
  listar(@Query('apenasAtivas') apenasAtivas?: string) {
    return this.service.listar(apenasAtivas === 'true');
  }

  @Get('arvore')
  @RequiresPermission('unidades.view')
  @ApiOperation({ summary: 'Retorna organograma completo em árvore' })
  arvore() {
    return this.service.arvore();
  }

  @Get(':id')
  @RequiresPermission('unidades.view')
  @ApiOperation({ summary: 'Buscar unidade por ID (com filhos e membros)' })
  buscarPorId(@Param('id') id: string) {
    return this.service.buscarPorId(id);
  }

  @Post()
  @RequiresPermission('unidades.create')
  @ApiOperation({ summary: 'Criar unidade organizacional' })
  criar(
    @Body() dto: CreateUnidadeDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.criar(dto, userId);
  }

  @Patch(':id')
  @RequiresPermission('unidades.edit')
  @ApiOperation({ summary: 'Atualizar unidade organizacional' })
  atualizar(
    @Param('id') id: string,
    @Body() dto: UpdateUnidadeDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.atualizar(id, dto, userId);
  }

  @Patch(':id/inativar')
  @RequiresPermission('unidades.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inativar unidade (soft delete)' })
  inativar(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.inativar(id, userId);
  }

  @Post(':id/usuarios/:usuarioId')
  @RequiresPermission('unidades.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adicionar usuário à unidade' })
  adicionarUsuario(
    @Param('id') unidadeId: string,
    @Param('usuarioId') usuarioId: string,
    @Query('principal') principal?: string,
  ) {
    return this.service.adicionarUsuario(unidadeId, usuarioId, principal === 'true');
  }

  @Delete(':id/usuarios/:usuarioId')
  @RequiresPermission('unidades.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover usuário da unidade' })
  removerUsuario(
    @Param('id') unidadeId: string,
    @Param('usuarioId') usuarioId: string,
  ) {
    return this.service.removerUsuario(unidadeId, usuarioId);
  }

  @Post(':id/visibilidades/:alvoId')
  @RequiresPermission('unidades.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Conceder visibilidade de outra unidade a esta (cascateia para filhos)' })
  adicionarVisibilidade(
    @Param('id') origemId: string,
    @Param('alvoId') alvoId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.adicionarVisibilidade(origemId, alvoId, userId);
  }

  @Delete(':id/visibilidades/:alvoId')
  @RequiresPermission('unidades.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revogar visibilidade de outra unidade' })
  removerVisibilidade(
    @Param('id') origemId: string,
    @Param('alvoId') alvoId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.removerVisibilidade(origemId, alvoId, userId);
  }
}
