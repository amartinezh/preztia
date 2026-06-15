import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { requireSession } from '../auth/require-role';

/**
 * Guard del PLANO DE CONTROL: exige un access token válido cuyo rol sea SUPER_ADMIN. A
 * diferencia del `JwtGuard`, NO requiere `x-tenant-id` (el super admin no tiene tenant y
 * cruza tenants). Es el único portón hacia la conexión BYPASSRLS.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const session = requireSession(req.headers['authorization']);
    if (session.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Requiere rol de super administrador');
    }
    return true;
  }
}
