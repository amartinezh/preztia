import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { isTenantOperating, TENANT_SUSPENDED } from '@preztiaos/domain';
import { verifyToken } from './jwt';
import { tenantStatusOf } from '../tenancy/tenant-status';

/**
 * Guard aditivo: verifica el access token (Bearer), exige que el `x-tenant-id` usado para RLS
 * COINCIDA con el tenant del JWT y que ese tenant siga operando (una empresa SUSPENDED corta las
 * sesiones vigentes: 401, el cliente vuelve al login, que explica el motivo). No reemplaza el
 * flujo de header existente (no toca el webhook de WhatsApp); solo blinda los endpoints de negocio.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authorization = req.headers['authorization'];
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      throw new UnauthorizedException('Falta el token de acceso');
    }
    const claims = verifyToken(authorization.slice('Bearer '.length));
    if (!claims || claims.typ !== 'access') {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    if (req.headers['x-tenant-id'] !== claims.tenantId) {
      throw new UnauthorizedException('El tenant no coincide con la sesión');
    }
    if (!isTenantOperating(await tenantStatusOf(claims.tenantId))) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'La empresa está suspendida',
        code: TENANT_SUSPENDED,
      });
    }
    return true;
  }
}
