import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as http from 'http';
import { WorkerAppModule } from './worker-app.module';

const logger = new Logger('WorkerBoot');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();

  // Cloud Run exige que o container responda HTTP para health checks.
  // Este servidor mínimo não processa lógica de negócio — apenas sinaliza
  // que o processo está vivo. A porta é injetada via WORKER_PORT (padrão: 8080).
  const port = process.env.WORKER_PORT ? Number.parseInt(process.env.WORKER_PORT, 10) : 8080;
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.log(`health server ouvindo na porta ${port}`);
  });
}

bootstrap().catch((err: unknown) => {
  logger.error('falha ao iniciar', err);
  process.exit(1);
});
