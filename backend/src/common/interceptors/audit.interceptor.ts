import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable, concatMap } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';
import { Reflector } from '@nestjs/core';
import { AuditAcao } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export const AUDIT_META_KEY = 'audit_meta';

export interface AuditMeta {
  acao: AuditAcao;
  entidadeTipo: string;
}

export const Audit = (acao: AuditAcao, entidadeTipo: string) =>
  (target: any, key: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(AUDIT_META_KEY, { acao, entidadeTipo }, descriptor.value);
    return descriptor;
  };

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const correlationId: string = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = correlationId;

    const auditMeta = this.reflector.get<AuditMeta>(
      AUDIT_META_KEY,
      context.getHandler(),
    );

    const start = Date.now();

    return next.handle().pipe(
      concatMap(async (responseData) => {
        if (!auditMeta) return responseData;

        const user = req.user;
        const entidadeId =
          responseData?.id ||
          req.params?.id ||
          responseData?.data?.id ||
          'unknown';

        try {
          await this.prisma.auditLog.create({
            data: {
              correlationId,
              tenantId: user?.tenantId || null,
              usuarioId: user?.sub || null,
              entidadeTipo: auditMeta.entidadeTipo,
              entidadeId: String(entidadeId),
              acao: auditMeta.acao,
              payloadDepois: responseData || {},
              ipOrigem: req.ip,
              userAgent: req.headers['user-agent'],
            },
          });
        } catch (err) {
          this.logger.error('Falha ao gravar log de auditoria', err);
        }

        this.logger.log({
          message: 'Operação auditada',
          correlationId,
          userId: user?.sub,
          acao: auditMeta.acao,
          entidade: auditMeta.entidadeTipo,
          entidadeId,
          durationMs: Date.now() - start,
        });

        return responseData;
      }),
    );
  }
}
