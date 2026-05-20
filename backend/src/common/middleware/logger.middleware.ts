import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request');

  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) || uuidv4();

    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    this.logger.log({
      message: `Incoming: ${req.method} ${req.originalUrl}`,
      correlationId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    next();
  }
}
