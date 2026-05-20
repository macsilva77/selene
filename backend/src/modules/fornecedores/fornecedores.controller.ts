import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FornecedoresService } from './fornecedores.service';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';
import { UpdateFornecedorDto } from './dto/update-fornecedor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FornecedorAccessGuard } from './guards/fornecedor-access.guard';

@ApiTags('Fornecedores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FornecedorAccessGuard)
@Controller('fornecedores')
export class FornecedoresController {
  constructor(private readonly fornecedoresService: FornecedoresService) {}

  @Post()
  @RequiresPermission('fornecedores.create')
  @ApiOperation({ summary: 'Cadastrar fornecedor' })
  criar(
    @Body() dto: CreateFornecedorDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.fornecedoresService.criar(dto, userId);
  }

  @Get('cnpj-lookup/:cnpj')
  @RequiresPermission('fornecedores.view')
  @ApiOperation({ summary: 'Consultar dados do CNPJ via BrasilAPI' })
  buscarCnpj(@Param('cnpj') cnpj: string) {
    return this.fornecedoresService.buscarCnpj(cnpj);
  }

  @Get()
  @RequiresPermission('fornecedores.view')
  @ApiOperation({ summary: 'Listar fornecedores' })
  listar(
    @Query('search') search?: string,
    @Query('ativo') ativo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fornecedoresService.listar({
      search,
      ativo: ativo === undefined ? undefined : ativo === 'true',
      page: page ? Number.parseInt(page) : 1,
      limit: limit ? Math.min(Number.parseInt(limit), 100) : 20,
    });
  }

  @Get(':id')
  @RequiresPermission('fornecedores.view')
  @ApiOperation({ summary: 'Buscar fornecedor por ID' })
  buscarPorId(@Param('id') id: string) {
    return this.fornecedoresService.buscarPorId(id);
  }

  @Patch(':id')
  @RequiresPermission('fornecedores.edit')
  @ApiOperation({ summary: 'Atualizar fornecedor' })
  atualizar(@Param('id') id: string, @Body() dto: UpdateFornecedorDto, @CurrentUser('sub') userId: string) {
    return this.fornecedoresService.atualizar(id, dto, userId);
  }

  @Delete(':id')
  @RequiresPermission('fornecedores.inativar')
  @ApiOperation({ summary: 'Inativar fornecedor (ADMIN)' })
  inativar(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.fornecedoresService.inativar(id, userId);
  }
}
