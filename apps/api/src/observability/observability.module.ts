import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogRepository } from './audit-log.repository';
import { IdempotencyRepository } from './idempotency.repository';
import { AuditInterceptor } from './audit.interceptor';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Observabilidad transversal: idempotencia de dinero (`Idempotency-Key`) y bitácora append-only
 * (`audit_log`). Registra ambos como interceptores globales. ORDEN: idempotencia es el MÁS
 * externo, así un reintento cacheado corta antes de auditar (no duplica entradas de auditoría).
 */
@Module({
  providers: [
    AuditLogRepository,
    IdempotencyRepository,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class ObservabilityModule {}
