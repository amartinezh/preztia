import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { PortfolioMapClient } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { zoneScopePredicate } from '../iam/zone-scope';
import { resolveOverdueThreshold } from './critical-overdue-threshold';
import { daysSince } from './critical-clients.repository';
import type { Session } from '../auth/require-role';

/**
 * Read model del MAPA DE CARTERA: TODOS los créditos activos con coordenadas del cliente, con el
 * detalle que la UI muestra al tocar un marcador (saldo, cuotas, mora, próxima cuota). Marca
 * `critical` con el mismo umbral del mapa de cobro para pintar el marcador según severidad.
 * Solo lectura, bajo el rol `app` + RLS y scopeado por la zona del usuario (ADMIN: todo;
 * COORDINATOR: su(s) subárbol(es)), igual que la cartera. No contiene reglas de negocio.
 */
@Injectable()
export class PortfolioMapRepository {
  async list(
    session: Session,
  ): Promise<{ threshold: number; items: PortfolioMapClient[] }> {
    const today = new Date().toISOString().slice(0, 10);

    return withTenantTxFor(session.tenantId, async (tx) => {
      const threshold = await resolveOverdueThreshold(tx, session.tenantId);
      // Cuotas vencidas (no saldadas y con vencimiento anterior a hoy) y cuotas aún pendientes.
      const overdueFilter = sql`${schema.installment.paidMinor} < ${schema.installment.amountDueMinor} AND ${schema.installment.dueDate} < ${today}`;
      const pendingFilter = sql`${schema.installment.paidMinor} < ${schema.installment.amountDueMinor}`;

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
          phone: schema.borrower.phone,
          business: schema.borrower.business,
          zoneName: schema.zone.name,
          lat: schema.borrower.lat,
          lng: schema.borrower.lng,
          principalMinor: schema.credit.principalMinor,
          currency: schema.credit.currency,
          installmentsCount: schema.credit.installmentsCount,
          startDate: schema.credit.startDate,
          overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${overdueFilter})`,
          earliestOverdue: sql<
            string | null
          >`MIN(${schema.installment.dueDate}) FILTER (WHERE ${overdueFilter})`,
          nextDueDate: sql<
            string | null
          >`MIN(${schema.installment.dueDate}) FILTER (WHERE ${pendingFilter})`,
          installmentsPaid: sql<number>`COUNT(*) FILTER (WHERE ${schema.installment.paidMinor} >= ${schema.installment.amountDueMinor})`,
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
        .groupBy(schema.credit.id, schema.borrower.id, schema.zone.id);

      const items = rows
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => ({
          creditId: r.creditId,
          borrowerName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
          phone: r.phone ?? null,
          business: r.business ?? null,
          zoneName: r.zoneName ?? null,
          latitude: r.lat as number,
          longitude: r.lng as number,
          principalMinor: Number(r.principalMinor),
          totalDueMinor: Number(r.totalDue),
          paidMinor: Number(r.totalPaid),
          outstandingMinor: Number(r.totalDue) - Number(r.totalPaid),
          currency: r.currency,
          installmentsCount: r.installmentsCount,
          installmentsPaid: Number(r.installmentsPaid),
          overdueCount: Number(r.overdueCount),
          daysOverdue: daysSince(r.earliestOverdue, today),
          nextDueDate: r.nextDueDate,
          startDate: r.startDate,
          critical: Number(r.overdueCount) >= threshold,
        }));
      return { threshold, items };
    });
  }
}
