import { Module } from '@nestjs/common';
import { BrasilApiService } from './brasil-api.service';

@Module({
  providers: [BrasilApiService],
  exports: [BrasilApiService],
})
export class BrasilApiModule {}
