import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response, NextFunction } from 'express';
import { tenantStorage } from '../context/tenant-context';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];

    // Rotas públicas (sem token) passam direto — JwtAuthGuard trata a autenticação
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    try {
      const token = authHeader.slice(7);
      // verify() valida assinatura — impede que tokens forjados definam o tenant context
      const payload = this.jwtService.verify(token) as Record<string, any>;
      const tenantId = payload?.tenantId as string | undefined;

      if (tenantId) {
        return tenantStorage.run({ tenantId }, () => next());
      }
    } catch {
      // Token inválido ou expirado — JwtAuthGuard rejeita na sequência
    }

    return next();
  }
}
