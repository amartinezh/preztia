import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export const tenantStorage = new AsyncLocalStorage<{ tenantId: string }>();

export function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  // En real: extraer del JWT o del subdominio. Para el esqueleto, de un header.
  const tenantId = req.headers['x-tenant-id'];
  if (typeof tenantId !== 'string') return next(); // o lanzar 401 si tu política lo exige
  tenantStorage.run({ tenantId }, () => next());
}
