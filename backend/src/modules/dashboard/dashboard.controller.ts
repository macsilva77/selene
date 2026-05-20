import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequiresPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @RequiresPermission('dashboard.view')
  @ApiOperation({ summary: 'Painel principal com semáforo de criticidade' })
  getResumo(
    @CurrentUser('sub') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.dashboardService.getResumo(userId, userRole);
  }

  @Get('metricas')
  @RequiresPermission('dashboard.view')
  @ApiOperation({ summary: 'Métricas executivas consolidadas' })
  getMetricas(@CurrentUser('role') userRole: string) {
    return this.dashboardService.getMetricas(userRole);
  }
}
