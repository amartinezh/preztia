import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { BorrowerNote, BorrowerSummary } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read models de clientes: listado paginado con filtros (Cédula/Nombre + "sin créditos") y
// notas de cobro. RLS garantiza que solo aparecen los clientes del tenant.

@Injectable()
export class BorrowersQueryRepository {
  async listBorrowers(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    nationalId?: string;
    name?: string;
    withoutCredits?: boolean;
  }): Promise<{ items: BorrowerSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const conditions: SQL[] = [];
      if (input.nationalId) {
        conditions.push(
          ilike(schema.borrower.nationalId, `%${input.nationalId}%`),
        );
      }
      if (input.name) {
        // Coincide contra "nombre apellido" para que la búsqueda sea natural.
        conditions.push(
          ilike(
            sql`${schema.borrower.firstName} || ' ' || ${schema.borrower.lastName}`,
            `%${input.name}%`,
          ),
        );
      }
      if (input.withoutCredits) {
        conditions.push(
          sql`NOT EXISTS (SELECT 1 FROM ${schema.credit} WHERE ${schema.credit.borrowerId} = ${schema.borrower.id})`,
        );
      }
      const where = conditions.length ? and(...conditions) : undefined;

      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.borrower)
        .where(where);
      const rows = await tx
        .select()
        .from(schema.borrower)
        .where(where)
        .orderBy(desc(schema.borrower.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const items: BorrowerSummary[] = rows.map((row) => ({
        id: row.id,
        nationalId: row.nationalId,
        firstName: row.firstName,
        lastName: row.lastName,
        business: row.business,
        phone: row.phone,
        lat: row.lat,
        lng: row.lng,
        color: row.color,
        creditBlocked: row.creditBlocked,
        creditLimitMinor: row.creditLimitMinor,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  async listNotes(input: {
    tenantId: string;
    borrowerId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: BorrowerNote[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = eq(schema.borrowerNote.borrowerId, input.borrowerId);
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.borrowerNote)
        .where(where);
      const rows = await tx
        .select()
        .from(schema.borrowerNote)
        .where(where)
        .orderBy(desc(schema.borrowerNote.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const items: BorrowerNote[] = rows.map((row) => ({
        id: row.id,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }
}
