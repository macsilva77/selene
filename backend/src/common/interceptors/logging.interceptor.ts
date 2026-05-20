import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, user } = req;
    const correlationId = req.correlationId || req.headers['x-correlation-id'];
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse();
          this.logger.log({
            message: `${method} ${url} ${res.statusCode}`,
            correlationId,
            userId: user?.sub,
            durationMs: Date.now() - start,
          });
        },
        error: (err) => {
          this.logger.error({
            message: `${method} ${url} ERROR`,
            correlationId,
            userId: user?.sub,
            error: err.message,
            durationMs: Date.now() - start,
          });
        },
      }),
    );
  }
}
