import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { verifyToken } from '../auth/jwt';
import { AuditLogRepository } from './audit-log.repository';
import { sanitize } from './sanitize';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Registra en `audit_log` (append-only) cada mutación HTTP exitosa del plano de datos: quién
 * (actor del JWT), qué (método + ruta), entidad, correlación y cuerpo saneado. Transversal y no
 * invasivo (no toca los handlers). El fallo del audit nunca rompe la respuesta (best-effort).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditLogRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = header(req, 'x-tenant-id');
    // Solo se auditan mutaciones del plano de datos (con tenant). Login/webhook/super-admin: no.
    if (!MUTATING.has(req.method) || !tenantId || !UUID_RE.test(tenantId)) {
      return next.handle();
    }

    const actorId = actorFrom(header(req, 'authorization'));
    const correlationId = header(req, 'x-correlation-id');
    const routePath =
      (req.route as { path?: string } | undefined)?.path ?? req.url;
    const entity = routePath.split('/').filter(Boolean)[0] ?? 'unknown';
    const payload = sanitize(req.body);

    return next.handle().pipe(
      tap({
        next: (body) => {
          const entityId =
            (body as { id?: string } | null)?.id ??
            (req.params as { id?: string } | undefined)?.id ??
            null;
          void this.audit
            .record({
              tenantId,
              actorId,
              action: `${req.method} ${routePath}`,
              entity,
              entityId,
              payload,
              correlationId,
            })
            .catch(() => undefined);
        },
      }),
    );
  }
}

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}

function actorFrom(authorization: string | null): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const claims = verifyToken(authorization.slice('Bearer '.length));
  return claims?.typ === 'access' ? claims.sub : null;
}
