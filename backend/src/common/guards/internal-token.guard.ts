import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly token: string;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('internalApiToken') ?? '';
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-internal-token'];
    if (!this.token || provided !== this.token) {
      throw new UnauthorizedException('Token interno inválido');
    }
    return true;
  }
}
