import { Module } from '@nestjs/common';
import { SpedService } from './sped.service';
import { SpedPubSubConsumer } from './sped-pubsub.consumer';

@Module({
  providers: [SpedService, SpedPubSubConsumer],
  exports: [SpedService],
})
export class SpedModule {}
