import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmpresasService } from './empresas.service';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Empresas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('empresas')
export class EmpresasController {
  constructor(private readonly empresasService: EmpresasService) {}

  @Post()
  @RequiresPermission('empresas.create')
  @ApiOperation({ summary: 'Cadastrar empresa associada à conta' })
  criar(
    @Body() dto: CreateEmpresaDto,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.empresasService.criar(dto, usuarioId);
  }

  @Get('cnpj-lookup/:cnpj')
  @RequiresPermission('empresas.view')
  @ApiOperation({ summary: 'Consultar CNPJ via BrasilAPI' })
  buscarCnpj(@Param('cnpj') cnpj: string) {
    return this.empresasService.buscarCnpj(cnpj);
  }

  @Get('cep-lookup/:cep')
  @RequiresPermission('empresas.view')
  @ApiOperation({ summary: 'Consultar CEP via BrasilAPI' })
  buscarCep(@Param('cep') cep: string) {
    return this.empresasService.buscarCep(cep);
  }

  @Get()
  @RequiresPermission('empresas.view')
  @ApiOperation({ summary: 'Listar empresas da conta' })
  listar(
    @Query('search') search?: string,
    @Query('ativo') ativo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.empresasService.listar({
      search,
      ativo: ativo === undefined ? undefined : ativo === 'true',
      page: page ? Number.parseInt(page) : 1,
      limit: limit ? Math.min(Number.parseInt(limit), 500) : 20,
    });
  }

  @Get(':id')
  @RequiresPermission('empresas.view')
  @ApiOperation({ summary: 'Buscar empresa por ID' })
  buscarPorId(@Param('id') id: string) {
    return this.empresasService.buscarPorId(id);
  }

  @Patch(':id')
  @RequiresPermission('empresas.edit')
  @ApiOperation({ summary: 'Atualizar empresa' })
  atualizar(
    @Param('id') id: string,
    @Body() dto: UpdateEmpresaDto,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.empresasService.atualizar(id, dto, usuarioId);
  }

  @Delete(':id')
  @RequiresPermission('empresas.delete')
  @ApiOperation({ summary: 'Inativar empresa' })
  inativar(
    @Param('id') id: string,
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.empresasService.inativar(id, usuarioId);
  }
}
