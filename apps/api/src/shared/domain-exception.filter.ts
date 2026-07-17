import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
} from '@preztiaos/domain';

/**
 * Traduce los errores de dominio a códigos HTTP en la frontera, para que los controllers
 * deleguen (no usan try/catch de `DomainError`). Subtipos semánticos → 403/404/409; cualquier
 * otro `DomainError` (invariante violado que la validación de la frontera debió frenar) → 400.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    const status = statusFor(error);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        message: error.message,
        // Código estable del dominio (si lo hay): el cliente lo traduce a un mensaje accionable.
        ...(error.code ? { code: error.code } : {}),
      });
  }
}

function statusFor(error: DomainError): number {
  if (error instanceof NotFoundError) return HttpStatus.NOT_FOUND;
  if (error instanceof ConflictError) return HttpStatus.CONFLICT;
  if (error instanceof ForbiddenError) return HttpStatus.FORBIDDEN;
  return HttpStatus.BAD_REQUEST;
}
