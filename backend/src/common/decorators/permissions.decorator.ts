import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorador que define a permissão necessária para acessar uma rota.
 * A verificação é feita pelo PermissionsGuard, que consulta os perfis
 * do usuário no banco de dados.
 *
 * @example @RequiresPermission('contratos.view')
 */
export const RequiresPermission = (permission: string) =>
  SetMetadata(PERMISSIONS_KEY, permission);
