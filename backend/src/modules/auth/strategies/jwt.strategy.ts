import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service';
import { TokenBlacklistService } from '../token-blacklist.service';
import { COOKIE_NAMES } from '../../../common/constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly blacklistService: TokenBlacklistService,
  ) {
    super({
      // Aceita Bearer header (API clients) ou cookie HttpOnly (browser)
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: any) => req?.cookies?.[COOKIE_NAMES.ACCESS] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    tenantId: string;
    jti?: string;
    iat?: number;
  }) {
    // Rejeita token revogado via logout
    if (payload.jti) {
      const revoked = await this.blacklistService.isBlacklisted(payload.jti);
      if (revoked) throw new UnauthorizedException('Token revogado');
    }

    const user = await this.prisma.usuario.findFirst({
      where: { id: payload.sub, ativo: true },
      select: { id: true, email: true, role: true, tenantId: true, ativo: true, senhaAlteradaEm: true },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo');
    }

    // Revoga tokens emitidos antes da última troca de senha (reset). iat em
    // segundos; senhaAlteradaEm em ms. Tokens novos (login pós-reset) têm
    // iat posterior e passam normalmente.
    if (user.senhaAlteradaEm && payload.iat != null
        && payload.iat * 1000 < user.senhaAlteradaEm.getTime()) {
      throw new UnauthorizedException('Sessão expirada por redefinição de senha');
    }

    return { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId, jti: payload.jti };
  }
}
