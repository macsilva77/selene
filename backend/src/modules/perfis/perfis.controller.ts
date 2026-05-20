import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PerfisService } from './perfis.service';
import { CreatePerfilDto } from './dto/create-perfil.dto';
import { UpdatePerfilDto } from './dto/update-perfil.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Perfis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('perfis')
export class PerfisController {
  constructor(private readonly perfisService: PerfisService) {}

  @Get()
  @RequiresPermission('perfis.view')
  @ApiOperation({ summary: 'Listar perfis do tenant' })
  listar() {
    return this.perfisService.listar();
  }

  @Get('ativos')
  @RequiresPermission('perfis.view')
  @ApiOperation({ summary: 'Listar apenas perfis ativos (para seleção)' })
  listarAtivos() {
    return this.perfisService.listar(true);
  }

  @Post()
  @RequiresPermission('perfis.create')
  @ApiOperation({ summary: 'Criar perfil' })
  criar(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: CreatePerfilDto,
  ) {
    return this.perfisService.criar({ usuarioId }, dto);
  }

  @Patch(':id')
  @RequiresPermission('perfis.edit')
  @ApiOperation({ summary: 'Atualizar perfil' })
  atualizar(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePerfilDto,
  ) {
    return this.perfisService.atualizar({ usuarioId }, id, dto);
  }

  @Delete(':id')
  @RequiresPermission('perfis.delete')
  @ApiOperation({ summary: 'Remover perfil' })
  remover(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.perfisService.remover({ usuarioId }, id);
  }

  @Get(':id/usuarios')
  @RequiresPermission('perfis.view')
  @ApiOperation({ summary: 'Listar usuários de um perfil' })
  listarUsuarios(@Param('id') id: string) {
    return this.perfisService.listarUsuariosDoPerfil(id);
  }

  @Post(':id/usuarios/:usuarioAlvoId')
  @RequiresPermission('perfis.edit')
  @ApiOperation({ summary: 'Atribuir perfil a usuário' })
  atribuir(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') perfilId: string,
    @Param('usuarioAlvoId') usuarioAlvoId: string,
  ) {
    return this.perfisService.atribuirPerfil({ usuarioId }, perfilId, usuarioAlvoId);
  }

  @Delete(':id/usuarios/:usuarioAlvoId')
  @RequiresPermission('perfis.edit')
  @ApiOperation({ summary: 'Remover perfil de usuário' })
  removerDeUsuario(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') perfilId: string,
    @Param('usuarioAlvoId') usuarioAlvoId: string,
  ) {
    return this.perfisService.removerPerfil({ usuarioId }, perfilId, usuarioAlvoId);
  }

  @Get('usuario/:usuarioId')
  @RequiresPermission('perfis.view')
  @ApiOperation({ summary: 'Listar perfis de um usuário' })
  perfisDoUsuario(@Param('usuarioId') usuarioId: string) {
    return this.perfisService.perfisDoUsuario(usuarioId);
  }

  @Put('usuario/:usuarioAlvoId')
  @RequiresPermission('perfis.edit')
  @ApiOperation({ summary: 'Trocar perfil do usuário (remove anteriores e atribui o novo)' })
  trocarPerfil(
    @CurrentUser('sub') usuarioId: string,
    @Param('usuarioAlvoId') usuarioAlvoId: string,
    @Body() body: { perfilId: string },
  ) {
    return this.perfisService.trocarPerfil({ usuarioId }, usuarioAlvoId, body.perfilId);
  }
}
