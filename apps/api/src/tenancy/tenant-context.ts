import { AsyncLocalStorage } from 'node:async_hooks';
export const tenantStorage = new AsyncLocalStorage<{ tenantId: string }>();

export function tenantMiddleware(req: any, _res: any, next: () => void) {
  // En real: extraer del JWT o del subdominio. Para el esqueleto, de un header.
  const tenantId = req.headers['x-tenant-id'];
  if (!tenantId) return next(); // o lanzar 401 si tu política lo exige
  tenantStorage.run({ tenantId }, () => next());
}
