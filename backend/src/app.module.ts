import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';
import configuration from './config/configuration';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './database/prisma.module';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
// Modules
import { AuthModule } from './modules/auth/auth.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { FornecedoresModule } from './modules/fornecedores/fornecedores.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RedisCacheModule } from './modules/cache/cache.module';
import { PerfisModule } from './modules/perfis/perfis.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UnidadesOrganizacionaisModule } from './modules/unidades-organizacionais/unidades-organizacionais.module';
import { EmpresasModule } from './modules/empresas/empresas.module';
import { CertificadosModule } from './modules/certificados/certificados.module';
import { DfeDistribuicaoModule } from './modules/dfe-distribuicao/dfe-distribuicao.module';
import { EtiquetasModule } from './modules/etiquetas/etiquetas.module';


@Module({
  imports: [
    // Core config
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env'],
    }),
    AppConfigModule,

    // JWT global (usado pelo TenantMiddleware para decode)
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') },
      }),
    }),

    // Event bus
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),

    // Cron scheduler
    ScheduleModule.forRoot(),

    // Redis / Bull queues
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

    // Rate limiting (RNF-S08: 100 req/min por usuário)
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: (config.get<number>('throttle.ttl') ?? 60) * 1000,
            limit: config.get<number>('throttle.limit') ?? 100,
          },
        ],
      }),
    }),

    // Database
    PrismaModule,

    // Domain modules
    AuthModule,
    AuditoriaModule,
    HealthModule,
    JobsModule,
    FornecedoresModule,
    DashboardModule,
    RedisCacheModule,
    TenantsModule,
    PerfisModule,
    UnidadesOrganizacionaisModule,
    EmpresasModule,
    CertificadosModule,
    DfeDistribuicaoModule,
    EtiquetasModule,
  ],
  providers: [
    // Global exception filter
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Global logging interceptor
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },

    // Global audit interceptor (grava AuditLog para endpoints decorados com @Audit)
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },

    // Global rate limiting
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // PermissionsGuard registrado globalmente para poder ser injetado via @UseGuards()
    PermissionsGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
