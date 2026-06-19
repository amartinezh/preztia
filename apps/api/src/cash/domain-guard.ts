import { BadRequestException } from '@nestjs/common';
import { DomainError } from '@preztiaos/domain';

/**
 * Traduce una violación de invariante de dominio (DomainError) a HTTP 400 en la frontera del
 * repositorio. El resto de errores se propaga sin tocar (el filtro global de NestJS los maneja).
 */
export function guardDomain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError) throw new BadRequestException(err.message);
    throw err;
  }
}
