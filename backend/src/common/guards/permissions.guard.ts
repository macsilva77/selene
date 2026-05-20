import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../database/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

const PERMS_CACHE_TTL = 300; // 5 minutos

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Rota sem @RequiresPermission → apenas autenticação (JwtAuthGuard) é suficiente
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.sub) {
      throw new ForbiddenException('Usuário não autenticado.');
    }

    // ADMIN tem acesso irrestrito — não depende de lista de permissões no banco
    if (user.role === 'ADMIN') {
      return true;
    }

    const permissoesDoUsuario = await this.getPermissions(user.sub);

    if (!permissoesDoUsuario.has(requiredPermission)) {
      throw new ForbiddenException(
        `Permissão insuficiente: '${requiredPermission}' é necessária.`,
      );
    }

    return true;
  }

  private async getPermissions(userId: string): Promise<Set<string>> {
    const cacheKey = `perms:${userId}`;
    const cached = await this.cache.get<string[]>(cacheKey);
    if (cached) return new Set(cached);

    const perfilLinks = await this.prisma.usuarioPerfil.findMany({
      where: { usuarioId: userId },
      include: { perfil: { select: { permissoes: true } } },
    });

    const permissoes = [...new Set<string>(
      perfilLinks.flatMap((link) => link.perfil.permissoes),
    )];

    await this.cache.set(cacheKey, permissoes, PERMS_CACHE_TTL);
    return new Set(permissoes);
  }
}
