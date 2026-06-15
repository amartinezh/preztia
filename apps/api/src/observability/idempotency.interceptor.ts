import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { type Observable, from, mergeMap, of } from 'rxjs';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import { IdempotencyRepository } from './idempotency.repository';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Idempotencia de operaciones de dinero por `Idempotency-Key`. En endpoints marcados con
 * `@Idempotent()`: si ya hay un resultado guardado para (tenant, key) lo devuelve sin re-ejecutar
 * (evita doble cobro/abono/desembolso en reintentos); si no, ejecuta y persiste el resultado.
 * Sin clave de idempotencia, pasa de largo (comportamiento normal).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyRepository,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const idempotent = this.reflector.get<boolean>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );
    if (!idempotent) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = header(req, 'idempotency-key');
    const tenantId = header(req, 'x-tenant-id');
    if (!key || !tenantId || !UUID_RE.test(tenantId)) return next.handle();

    const existing = await this.store.find(tenantId, key);
    if (existing) {
      res.status(existing.status);
      return of(existing.response);
    }

    const method = req.method;
    const path = (req.route as { path?: string } | undefined)?.path ?? req.url;
    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          (async (): Promise<unknown> => {
            await this.store.save({
              tenantId,
              key,
              method,
              path,
              status: res.statusCode,
              response: body,
            });
            return body;
          })(),
        ),
      ),
    );
  }
}

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}
