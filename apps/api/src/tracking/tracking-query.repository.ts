import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { classifyBorrowerPosition } from '@preztiaos/domain';
import type { ClientPosition, LocationPoint } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read models de TRACKING: recorrido de un cobrador, su último registro y la posición de los
// clientes (deudores geolocalizados) con su estado. Solo lectura; RLS aísla por tenant.

@Injectable()
export class TrackingQueryRepository {
  async getTrack(input: {
    tenantId: string;
    collectorId: string;
    date: string;
  }): Promise<LocationPoint[]> {
    const dayStart = new Date(`${input.date}T00:00:00Z`);
    const dayEnd = new Date(`${input.date}T23:59:59.999Z`);
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.collectorLocation)
        .where(
          and(
            eq(schema.collectorLocation.collectorId, input.collectorId),
            gte(schema.collectorLocation.recordedAt, dayStart),
            lte(schema.collectorLocation.recordedAt, dayEnd),
          ),
        )
        .orderBy(asc(schema.collectorLocation.recordedAt));
      return rows.map(toPoint);
    });
  }

  async getLastLocation(input: {
    tenantId: string;
    collectorId: string;
  }): Promise<LocationPoint | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.collectorLocation)
        .where(eq(schema.collectorLocation.collectorId, input.collectorId))
        .orderBy(desc(schema.collectorLocation.recordedAt))
        .limit(1);
      return row ? toPoint(row) : null;
    });
  }

  async getClientPositions(input: {
    tenantId: string;
  }): Promise<ClientPosition[]> {
    const today = new Date().toISOString().slice(0, 10);
    return withTenantTxFor(input.tenantId, async (tx) => {
      // LEFT JOIN + agregados (mismo patrón que accounts-query): evita subconsultas correlacionadas
      // y la ambigüedad de columnas. hasCredits/anyOverdue se derivan de los conteos.
      const rows = await tx
        .select({
          id: schema.borrower.id,
          firstName: schema.borrower.firstName,
          lastName: schema.borrower.lastName,
          lat: schema.borrower.lat,
          lng: schema.borrower.lng,
          creditCount: sql<number>`COUNT(DISTINCT ${schema.credit.id})`,
          overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.installment.paidMinor} < ${schema.installment.amountDueMinor} AND ${schema.installment.dueDate} < ${today})`,
        })
        .from(schema.borrower)
        .leftJoin(
          schema.credit,
          eq(schema.credit.borrowerId, schema.borrower.id),
        )
        .leftJoin(
          schema.installment,
          eq(schema.installment.creditId, schema.credit.id),
        )
        .where(
          and(isNotNull(schema.borrower.lat), isNotNull(schema.borrower.lng)),
        )
        .groupBy(schema.borrower.id);

      return rows.map((row) => ({
        borrowerId: row.id,
        name: fullName(row.firstName, row.lastName),
        lat: row.lat as number,
        lng: row.lng as number,
        status: classifyBorrowerPosition({
          hasCredits: Number(row.creditCount) > 0,
          anyOverdue: Number(row.overdueCount) > 0,
        }),
      }));
    });
  }
}

function toPoint(
  row: typeof schema.collectorLocation.$inferSelect,
): LocationPoint {
  return {
    lat: row.lat,
    lng: row.lng,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function fullName(first: string | null, last: string | null): string | null {
  const name = `${first ?? ''} ${last ?? ''}`.trim();
  return name.length ? name : null;
}
