import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Traduce los errores de validación de zod (frontera del contrato) a HTTP 400, en lugar de
 * propagar un 500. Aplica a todos los controllers que validan con `.parse()`. Devuelve el
 * primer mensaje legible y el detalle de los `issues` para depurar el cliente.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost): void {
    const message = error.issues[0]?.message ?? 'Datos inválidos';
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.BAD_REQUEST)
      .json({
        statusCode: HttpStatus.BAD_REQUEST,
        message,
        issues: error.issues,
      });
  }
}
