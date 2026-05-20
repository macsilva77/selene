import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  tenantId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function getCurrentTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

export function requireTenantId(): string {
  const id = getCurrentTenantId();
  if (!id) throw new Error('TenantId não disponível no contexto atual');
  return id;
}
