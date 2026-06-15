import { Injectable } from '@nestjs/common';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { AssignableClient, CollectorClient } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read model de "clientes" (deudores). Un cliente es un borrower_id que aparece en `credit`.
// El alcance del coordinador (scope ltree) se aplica como predicado; el cobrador solo ve los
// clientes que le fueron asignados. Sin nombre de deudor en BD: viaja `null` (PII mínima).

@Injectable()
export class ClientsQueryRepository {
  /**
   * Clientes dentro del alcance del actor, marcando los ya asignados al cobrador. Agrupa por
   * deudor (un borrower puede tener varios créditos) y toma un teléfono/zona representativos.
   */
  async listAssignableClients(input: {
    tenantId: string;
    collectorId: string;
    page: number;
    pageSize: number;
    scope?: SQL;
  }): Promise<{ items: AssignableClient[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const assigned = await tx
        .select({ borrowerId: schema.collectorClient.borrowerId })
        .from(schema.collectorClient)
        .where(eq(schema.collectorClient.collectorId, input.collectorId));
      const assignedSet = new Set(assigned.map((r) => r.borrowerId));

      const [totalRow] = await tx
        .select({
          value: sql<number>`count(distinct ${schema.credit.borrowerId})`,
        })
        .from(schema.credit)
        .innerJoin(schema.zone, eq(schema.zone.id, schema.credit.zoneId))
        .where(input.scope);

      const rows = await tx
        .select({
          borrowerId: schema.credit.borrowerId,
          zonePath: sql<string | null>`max(${schema.zone.path}::text)`,
          phone: sql<string | null>`max(${schema.borrowerContact.phone})`,
        })
        .from(schema.credit)
        .innerJoin(schema.zone, eq(schema.zone.id, schema.credit.zoneId))
        .leftJoin(
          schema.borrowerContact,
          eq(schema.borrowerContact.borrowerId, schema.credit.borrowerId),
        )
        .where(input.scope)
        .groupBy(schema.credit.borrowerId)
        .orderBy(asc(schema.credit.borrowerId))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const items: AssignableClient[] = rows.map((row) => ({
        borrowerId: row.borrowerId,
        name: null,
        phone: row.phone ?? null,
        zonePath: row.zonePath ?? null,
        assigned: assignedSet.has(row.borrowerId),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  /** Clientes asignados al cobrador autenticado (su cartera). */
  async listMyClients(input: {
    tenantId: string;
    collectorId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: CollectorClient[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = eq(schema.collectorClient.collectorId, input.collectorId);
      const [totalRow] = await tx
        .select({ value: sql<number>`count(*)` })
        .from(schema.collectorClient)
        .where(where);

      const rows = await tx
        .select({
          borrowerId: schema.collectorClient.borrowerId,
          phone: sql<string | null>`max(${schema.borrowerContact.phone})`,
          zonePath: sql<string | null>`max(${schema.zone.path}::text)`,
        })
        .from(schema.collectorClient)
        .leftJoin(
          schema.borrowerContact,
          eq(
            schema.borrowerContact.borrowerId,
            schema.collectorClient.borrowerId,
          ),
        )
        .leftJoin(
          schema.credit,
          eq(schema.credit.borrowerId, schema.collectorClient.borrowerId),
        )
        .leftJoin(schema.zone, eq(schema.zone.id, schema.credit.zoneId))
        .where(where)
        .groupBy(schema.collectorClient.borrowerId)
        .orderBy(asc(schema.collectorClient.borrowerId))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const items: CollectorClient[] = rows.map((row) => ({
        borrowerId: row.borrowerId,
        name: null,
        phone: row.phone ?? null,
        zonePath: row.zonePath ?? null,
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }
}
