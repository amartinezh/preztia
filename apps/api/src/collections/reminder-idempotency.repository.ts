import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import type { ReminderIdempotencyStore } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

const REMINDER_METHOD = 'CRON';
const REMINDER_PATH = '/collections/collection-reminder';

/**
 * Idempotencia del cobro diario sobre la tabla `idempotency_key` (única por tenant+clave): inserta
 * la clave `collection-reminder:{creditId}:{fecha}` con `ON CONFLICT DO NOTHING`. Si la inserción
 * crea la fila, es el primer envío del día → se reserva; si choca, ya se envió → no se reenvía.
 * Así, reintentos del cron, doble réplica o un disparo manual repetido no duplican el mensaje.
 */
@Injectable()
export class ReminderIdempotencyRepository implements ReminderIdempotencyStore {
  async claimDailyReminder(input: {
    tenantId: string;
    creditId: string;
    date: string;
  }): Promise<boolean> {
    const key = `collection-reminder:${input.creditId}:${input.date}`;
    return withTenantTxFor(input.tenantId, async (tx) => {
      const inserted = await tx
        .insert(schema.idempotencyKey)
        .values({
          tenantId: input.tenantId,
          key,
          method: REMINDER_METHOD,
          path: REMINDER_PATH,
          status: 200,
        })
        .onConflictDoNothing()
        .returning({ id: schema.idempotencyKey.id });
      return inserted.length > 0;
    });
  }
}
