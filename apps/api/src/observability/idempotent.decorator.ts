import { SetMetadata } from '@nestjs/common';

// Marca un endpoint de dinero como idempotente: el IdempotencyInterceptor cachea su resultado
// por `Idempotency-Key` y evita re-ejecutarlo en reintentos (sin doble cobro/abono/desembolso).
export const IDEMPOTENT_KEY = 'preztia:idempotent';
export const Idempotent = (): MethodDecorator =>
  SetMetadata(IDEMPOTENT_KEY, true);
