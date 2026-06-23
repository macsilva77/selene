import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AppConfigService } from '../../config/app-config.service';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { LoginDto } from './dto/login.dto';
import { AuditAcao } from '@prisma/client';

@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
    private readonly blacklistService: TokenBlacklistService,
  ) {}

  async login(dto: LoginDto, ip: string, userAgent: string) {
    if (await this.blacklistService.isLoginLocked(dto.email, dto.tenantSlug)) {
      throw new UnauthorizedException(
        'Conta temporariamente bloqueada por múltiplas tentativas falhas. Tente novamente em 15 minutos.',
      );
    }

    if (await this.blacklistService.isIpLocked(ip)) {
      throw new UnauthorizedException(
        'Muitas tentativas a partir deste endereço. Tente novamente em 15 minutos.',
      );
    }

    const user = await this.prisma.usuario.findFirst({
      where: {
        email: dto.email,
        ativo: true,
        ...(dto.tenantSlug ? { tenant: { slug: dto.tenantSlug } } : {}),
      },
      include: {
        tenant: { select: { id: true, slug: true, ativo: true, plano: true } },
        perfis: { include: { perfil: { select: { permissoes: true } } } },
      },
    });

    if (!user) {
      await Promise.all([
        this.blacklistService.trackFailedLogin(dto.email, dto.tenantSlug),
        this.blacklistService.trackFailedLoginIp(ip),
        this.prisma.auditLog.create({
          data: {
            entidadeTipo: 'Usuario',
            entidadeId:   dto.email,
            acao:         AuditAcao.LOGIN_FALHO,
            payloadDepois: { motivo: 'usuario_nao_encontrado' },
            ipOrigem:     ip,
            userAgent,
          },
        }),
      ]);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    if (!user.ativo) {
      throw new UnauthorizedException('Usuário inativo. Entre em contato com o administrador.');
    }

    if (!user.tenant.ativo) {
      throw new UnauthorizedException('Organização inativa. Entre em contato com o suporte.');
    }

    const senhaValida = user.senhaHash
      ? await bcrypt.compare(dto.senha, user.senhaHash)
      : false;
    if (!senhaValida) {
      await Promise.all([
        this.blacklistService.trackFailedLogin(dto.email, dto.tenantSlug),
        this.blacklistService.trackFailedLoginIp(ip),
        this.prisma.auditLog.create({
          data: {
            tenantId:     user.tenantId,
            usuarioId:    user.id,
            entidadeTipo: 'Usuario',
            entidadeId:   user.id,
            acao:         AuditAcao.LOGIN_FALHO,
            payloadDepois: { motivo: 'senha_invalida' },
            ipOrigem:     ip,
            userAgent,
          },
        }),
      ]);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    await this.blacklistService.clearLoginFailures(dto.email, dto.tenantSlug);

    const tokens = await this.gerarTokens(user.id, user.email, user.role, user.tenantId);

    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        usuarioId: user.id,
        entidadeTipo: 'Usuario',
        entidadeId: user.id,
        acao: AuditAcao.LOGIN,
        payloadDepois: { email: user.email, role: user.role, tenantId: user.tenantId },
        ipOrigem: ip,
        userAgent,
      },
    });

    const permissoes = [...new Set(user.perfis.flatMap((up) => up.perfil.permissoes))];

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        permissoes,
        tenant: { slug: user.tenant.slug, plano: user.tenant.plano },
      },
    };
  }

  async logout(userId: string, tenantId: string, jti: string, ip: string, refreshToken?: string) {
    const { expiresIn, refreshSecret, refreshExpiresIn } = this.appConfig.jwt;
    const accessTtl = this.parseTtlToSeconds(expiresIn);
    await this.blacklistService.blacklist(jti, accessTtl);

    if (refreshToken) {
      try {
        const rp = this.jwtService.verify(refreshToken, {
          secret: refreshSecret,
        }) as { jti?: string; exp?: number };
        if (rp.jti) {
          const ttl = rp.exp
            ? rp.exp - Math.floor(Date.now() / 1000)
            : this.parseTtlToSeconds(refreshExpiresIn);
          if (ttl > 0) await this.blacklistService.blacklist(rp.jti, ttl);
        }
      } catch { /* token inválido — ignora e conclui o logout normalmente */ }
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        usuarioId: userId,
        entidadeTipo: 'Usuario',
        entidadeId: userId,
        acao: AuditAcao.LOGOUT,
        payloadDepois: {},
        ipOrigem: ip,
      },
    });
    return { message: 'Logout realizado com sucesso' };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.appConfig.jwt.refreshSecret,
      }) as { sub: string; jti?: string };

      if (payload.jti) {
        const revoked = await this.blacklistService.isBlacklisted(payload.jti);
        if (revoked) throw new UnauthorizedException('Refresh token revogado');
      }

      const user = await this.prisma.usuario.findFirst({
        where: { id: payload.sub, ativo: true },
      });

      if (!user) throw new UnauthorizedException('Usuário inativo');

      return this.gerarTokens(user.id, user.email, user.role, user.tenantId);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }
  }

  async gerarTokens(userId: string, email: string, role: string, tenantId: string) {
    const jti = randomUUID();
    const refreshJti = randomUUID();

    const jwt = this.appConfig.jwt;
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email, role, tenantId, jti },
        { secret: jwt.secret, expiresIn: jwt.expiresIn },
      ),
      this.jwtService.signAsync(
        { sub: userId, jti: refreshJti },
        { secret: jwt.refreshSecret, expiresIn: jwt.refreshExpiresIn },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  parseTtlToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 3600;
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number.parseInt(match[1], 10) * multipliers[match[2]];
  }
}
