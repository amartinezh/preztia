import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { CriticalClient } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { zoneScopePredicate } from '../iam/zone-scope';
import { resolveOverdueThreshold } from './critical-overdue-threshold';
import type { Session } from '../auth/require-role';

const MILLIS_PER_DAY = 86_400_000;

/**
 * Read model del MAPA DE COBRO: clientes en mora CRÍTICA. Un cliente es crítico cuando su crédito
 * activo acumula ≥ `CRITICAL_OVERDUE_THRESHOLD` (env) cuotas vencidas y tiene coordenadas. Solo
 * lectura, bajo el rol `app` + RLS y scopeado por la zona del usuario (ADMIN: todo; COORDINATOR:
 * su(s) subárbol(es)), igual que la cartera. No contiene reglas de negocio.
 */
@Injectable()
export class CriticalClientsRepository {
  async list(
    session: Session,
  ): Promise<{ threshold: number; items: CriticalClient[] }> {
    const today = new Date().toISOString().slice(0, 10);

    return withTenantTxFor(session.tenantId, async (tx) => {
      const threshold = await resolveOverdueThreshold(tx, session.tenantId);
      // Cuotas vencidas (no saldadas y con vencimiento anterior a hoy).
      const overdueFilter = sql`${schema.installment.paidMinor} < ${schema.installment.amountDueMinor} AND ${schema.installment.dueDate} < ${today}`;
      const overdueCount = sql<number>`COUNT(*) FILTER (WHERE ${overdueFilter})`;
      const earliestOverdue = sql<
        string | null
      >`MIN(${schema.installment.dueDate}) FILTER (WHERE ${overdueFilter})`;

      const conditions = [
        eq(schema.credit.status, 'ACTIVE'),
        sql`${schema.borrower.lat} IS NOT NULL AND ${schema.borrower.lng} IS NOT NULL`,
        zoneScopePredicate(session, sql`${schema.zone.path}`),
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);

      const rows = await tx
        .select({
          creditId: schema.credit.id,
          firstName: schema.borrower.firstName,
          lastName: schema.borrower.lastName,
          lat: schema.borrower.lat,
          lng: schema.borrower.lng,
          currency: schema.credit.currency,
          overdueCount,
          earliestOverdue,
          totalDue: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor}), 0)`,
          totalPaid: sql<number>`COALESCE(SUM(${schema.installment.paidMinor}), 0)`,
        })
        .from(schema.credit)
        .leftJoin(
          schema.borrower,
          eq(schema.borrower.id, schema.credit.borrowerId),
        )
        .leftJoin(schema.zone, eq(schema.zone.id, schema.credit.zoneId))
        .leftJoin(
          schema.installment,
          eq(schema.installment.creditId, schema.credit.id),
        )
        .where(and(...conditions))
        .groupBy(schema.credit.id, schema.borrower.id, schema.zone.id)
        .having(sql`COUNT(*) FILTER (WHERE ${overdueFilter}) >= ${threshold}`);

      const items = rows
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => ({
          creditId: r.creditId,
          borrowerName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
          latitude: r.lat as number,
          longitude: r.lng as number,
          overdueCount: Number(r.overdueCount),
          daysOverdue: daysSince(r.earliestOverdue, today),
          outstandingMinor: Number(r.totalDue) - Number(r.totalPaid),
          currency: r.currency,
        }));
      return { threshold, items };
    });
  }
}

/** Días transcurridos desde `date` hasta `today` (0 si no hay fecha o aún no vence). */
export function daysSince(date: string | null, today: string): number {
  if (!date) return 0;
  const diff = Date.parse(today) - Date.parse(date);
  return diff > 0 ? Math.floor(diff / MILLIS_PER_DAY) : 0;
}
