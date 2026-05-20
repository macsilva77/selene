import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '../../../common/enums/roles.enum';

@Injectable()
export class FornecedorAccessGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    const method = req.method;

    // AUD_EXT não tem acesso a fornecedores
    if (user.role === Role.AUD_EXT) {
      throw new ForbiddenException('Auditor externo não tem acesso a fornecedores');
    }

    // RESP e AUD_INT só leitura (GET)
    if ([Role.RESP, Role.AUD_INT].includes(user.role) && method !== 'GET') {
      throw new ForbiddenException('Perfil sem permissão para alterar fornecedores');
    }

    return true;
  }
}
