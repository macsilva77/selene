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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';

@ApiTags('Tenants (SaaS Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequiresPermission('usuarios.manage')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @ApiOperation({ summary: 'Criar novo tenant (ADMIN global)' })
  criar(@Body() dto: CreateTenantDto) {
    return this.tenantsService.criar(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos os tenants (ADMIN global)' })
  listar(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tenantsService.listar(
      page ? Number.parseInt(page) : 1,
      limit ? Math.min(Number.parseInt(limit), 100) : 20,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar tenant por ID' })
  buscarPorId(@Param('id') id: string) {
    return this.tenantsService.buscarPorId(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar tenant' })
  atualizar(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.atualizar(id, dto);
  }

  @Post(':id/suspender')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspender tenant (desativa acesso)' })
  suspender(@Param('id') id: string) {
    return this.tenantsService.suspender(id);
  }

  @Post(':id/reativar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reativar tenant suspenso' })
  reativar(@Param('id') id: string) {
    return this.tenantsService.reativar(id);
  }
}
