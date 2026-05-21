import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
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

  // Swagger — disponível em todos os ambientes
  if (true) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SIGIC API')
      .setDescription('Sistema de Gestão de Iniciativas e Contratos — API REST')
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

  Logger.log(`SIGIC Backend rodando na porta ${port}`, 'Bootstrap');
  Logger.log(`Ambiente: ${config.get<string>('nodeEnv')}`, 'Bootstrap');
}

bootstrap();
