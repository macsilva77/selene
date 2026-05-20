import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [
    CacheModule.register({ ttl: 60, max: 100 }),
  ],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
