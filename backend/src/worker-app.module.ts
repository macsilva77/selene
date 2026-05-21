import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import configuration from './config/configuration';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './database/prisma.module';
import { RedisCacheModule } from './modules/cache/cache.module';
import { DfeDistribuicaoWorkerModule } from './modules/dfe-distribuicao/dfe-distribuicao-worker.module';

/**
 * Módulo raiz do processo Worker.
 *
 * Contém apenas infraestrutura necessária para os workers DFe:
 *   - ConfigModule / ScheduleModule / BullModule (mesma config do AppModule)
 *   - PrismaModule (acesso ao banco)
 *   - DfeDistribuicaoWorkerModule (@Processor + @Cron do DFe)
 *
 * Não inclui: HTTP controllers, JWT, ThrottlerModule, EventEmitterModule,
 * nem nenhum módulo de domínio não-DFe.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    AppConfigModule,
    RedisCacheModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password') || undefined,
          lazyConnect: true,
          retryStrategy: (times: number) =>
            times > 6 ? null : Math.min(times * 2000, 10_000),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      }),
    }),
    PrismaModule,
    DfeDistribuicaoWorkerModule,
  ],
})
export class WorkerAppModule {}
