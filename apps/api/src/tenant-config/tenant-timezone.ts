import { sql } from 'drizzle-orm';
import {
  addDays,
  businessDateOf,
  DEFAULT_TIME_ZONE,
  localHourInstant,
} from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/**
 * Zona horaria IANA de la EMPRESA (`operational_settings.timeZone`, Ajustes → General). Es la ÚNICA
 * fuente del "hoy" y de los cortes: liquidación, fecha de los pagos, rendición, cartera,
 * recordatorios y migrados. Sin configurar, la del dominio por defecto.
 */
export async function resolveTenantTimeZone(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT operational_settings->>'timeZone' AS time_zone
    FROM tenant_config WHERE tenant_id = ${tenantId} LIMIT 1
  `)) as unknown as Array<{ time_zone: string | null }>;
  return rows[0]?.time_zone ?? DEFAULT_TIME_ZONE;
}

/** Día de negocio de hoy (YYYY-MM-DD) en la zona horaria del tenant. */
export async function tenantToday(
  tx: Tx,
  tenantId: string,
  now = new Date(),
): Promise<string> {
  return businessDateOf(now, await resolveTenantTimeZone(tx, tenantId));
}

// Un día de negocio empieza a la medianoche LOCAL de la empresa; la primera hora del día.
const START_OF_DAY_HOUR = 0;
const ONE_DAY = 1;

/**
 * Ventana de un día de negocio como instantes UTC, semiabierta: `[start, end)`. `end` es el
 * inicio del día siguiente, de modo que ningún instante queda fuera ni se cuenta dos veces
 * (también en los días de cambio de horario, que duran 23 o 25 horas).
 */
export interface BusinessDayBounds {
  /** Día de negocio (YYYY-MM-DD) al que se refiere la ventana. */
  readonly date: string;
  /** Primer instante del día (inclusive). */
  readonly start: Date;
  /** Primer instante del día siguiente (exclusive). */
  readonly end: Date;
}

/** Regla pura: límites del día de negocio `date` en la zona horaria `timeZone`. */
export function businessDayBoundsIn(
  date: string,
  timeZone: string,
): BusinessDayBounds {
  return {
    date,
    start: localHourInstant(date, START_OF_DAY_HOUR, timeZone),
    end: localHourInstant(addDays(date, ONE_DAY), START_OF_DAY_HOUR, timeZone),
  };
}

/**
 * Límites del día de negocio del tenant dentro de la transacción: `date` explícita o, si no
 * viene, el "hoy" de la EMPRESA (nunca el de UTC: en Colombia el día no se vacía a las 19:00).
 */
export async function businessDayBounds(
  tx: Tx,
  tenantId: string,
  date?: string,
  now = new Date(),
): Promise<BusinessDayBounds> {
  const timeZone = await resolveTenantTimeZone(tx, tenantId);
  return businessDayBoundsIn(date ?? businessDateOf(now, timeZone), timeZone);
}
