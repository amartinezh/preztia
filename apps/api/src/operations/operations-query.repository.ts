import { Injectable } from '@nestjs/common';
import { count, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ChangeRequest,
  ChangeRequestStatus,
  Route,
} from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read models de OPERACIONES: solicitudes de cambio (inbox) y rutas/cobros (cobradores con su
// cartera y zonas). Solo lectura; RLS aísla por tenant.

@Injectable()
export class OperationsQueryRepository {
  async listChangeRequests(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    status?: ChangeRequestStatus;
  }): Promise<{ items: ChangeRequest[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = input.status
        ? eq(schema.changeRequest.status, input.status)
        : undefined;
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.changeRequest)
        .where(where);
      const rows = await tx
        .select()
        .from(schema.changeRequest)
        .where(where)
        .orderBy(desc(schema.changeRequest.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const items: ChangeRequest[] = rows.map((row) => ({
        id: row.id,
        borrowerId: row.borrowerId,
        requestedBy: row.requestedBy,
        changes: row.changes as Record<string, unknown>,
        status: row.status,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  /** Lista de cobros: cada COLLECTOR con sus zonas y número de clientes asignados. */
  async listRoutes(tenantId: string): Promise<Route[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select({
          collectorId: schema.appUser.id,
          email: schema.appUser.email,
          zonePaths: schema.appUser.zonePaths,
          active: schema.appUser.active,
          clients: sql<number>`COUNT(${schema.collectorClient.borrowerId})`,
        })
        .from(schema.appUser)
        .leftJoin(
          schema.collectorClient,
          eq(schema.collectorClient.collectorId, schema.appUser.id),
        )
        .where(eq(schema.appUser.role, 'COLLECTOR'))
        .groupBy(schema.appUser.id)
        .orderBy(schema.appUser.email);
      return rows.map((row) => ({
        collectorId: row.collectorId,
        name: row.email,
        code: row.collectorId.slice(0, 8),
        zonePaths: row.zonePaths,
        clientsCount: Number(row.clients),
        active: row.active,
      }));
    });
  }
}
