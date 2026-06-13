import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { verifyToken } from './jwt';

/**
 * Guard aditivo: verifica el access token (Bearer) y exige que el `x-tenant-id`
 * usado para RLS COINCIDA con el tenant del JWT. No reemplaza el flujo de header
 * existente (no toca el webhook de WhatsApp); solo blinda los endpoints de negocio.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
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
    return true;
  }
}
