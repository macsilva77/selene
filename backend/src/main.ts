import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  const config = app.get(ConfigService);

  // Security headers
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  // CORS
  const isDev = config.get<string>('nodeEnv') !== 'production';
  const appUrl = config.get<string>('appUrl') ?? '';
  app.enableCors({
    origin: isDev
      ? /^http:\/\/localhost(:\d+)?$/
      : [appUrl, /\.inovaprojetosti\.com\.br$/],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global pipes — class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      errorHttpStatusCode: 422,
    }),
  );

  // Global guards aplicados via providers no AppModule
  // JWT e Roles guards são configurados por módulo quando necessário

  // Swagger — desabilitado em produção por padrão
  if (isDev || process.env['SWAGGER_ENABLED'] === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Selene API')
      .setDescription('Selene — Plataforma de Gestão Empresarial — API REST')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth')
      .addTag('Contratos')
      .addTag('Pendências')
      .addTag('Iniciativas')
      .addTag('Licitações')
      .addTag('Notificações')
      .addTag('Auditoria')
      .addTag('Health')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    Logger.log('Swagger disponível em /api/docs', 'Bootstrap');
  }

  const port = config.get<number>('port') || 3000;
  await app.listen(port);

  Logger.log(`Selene Backend rodando na porta ${port}`, 'Bootstrap');
  Logger.log(`Ambiente: ${config.get<string>('nodeEnv')}`, 'Bootstrap');

  // Limpa arquivos temporários Parquet ao encerrar (SIGTERM do Cloud Run)
  process.on('SIGTERM', async () => {
    Logger.log('SIGTERM recebido — limpando /tmp e encerrando', 'Bootstrap');
    try {
      const tmpDir = os.tmpdir();
      const entries = await fs.readdir(tmpDir);
      await Promise.allSettled(
        entries
          .filter(f => f.startsWith('selene-ecf-') && f.endsWith('.parquet'))
          .map(f => fs.unlink(path.join(tmpDir, f))),
      );
    } catch { /* ignora erros de limpeza */ }
    await app.close();
  });
}

bootstrap();
