import { count, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type CreditSummary } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Read model del slice de crédito: listado paginado para la API. Solo lectura, sin
 * reglas de negocio. El nombre del deudor (PII) no se materializa aquí (`null`): el
 * cliente opera con identificadores y montos.
 */
export class CreditQueryRepository {
  async listCredits(input: {
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: CreditSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.credit);

      const rows = await tx
        .select({
          id: schema.credit.id,
          borrowerId: schema.credit.borrowerId,
          zoneId: schema.credit.zoneId,
          zonePath: schema.zone.path,
          principalMinor: schema.credit.principalMinor,
          currency: schema.credit.currency,
          installmentsCount: schema.credit.installmentsCount,
          status: schema.credit.status,
          createdAt: schema.credit.createdAt,
        })
        .from(schema.credit)
        .leftJoin(schema.zone, eq(schema.zone.id, schema.credit.zoneId))
        .orderBy(desc(schema.credit.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const items: CreditSummary[] = rows.map((row) => ({
        id: row.id,
        borrowerId: row.borrowerId,
        borrowerName: null,
        zoneId: row.zoneId,
        zonePath: row.zonePath ?? null,
        principalMinor: row.principalMinor,
        currency: row.currency,
        installmentsCount: row.installmentsCount,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }
}
