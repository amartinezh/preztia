import { UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';

const uuid = z.string().uuid();

/**
 * Exige una identidad de tenant válida en la frontera. El tenant se toma del header
 * `x-tenant-id` (que el `JwtGuard` ya verificó contra el claim del JWT). 401 si falta.
 */
export function requireTenant(tenantId: string | undefined): string {
  const parsed = uuid.safeParse(tenantId);
  if (!parsed.success) {
    throw new UnauthorizedException('Falta la identidad del tenant');
  }
  return parsed.data;
}
