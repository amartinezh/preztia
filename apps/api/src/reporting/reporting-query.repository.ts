import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { BorrowerReport, Dashboard } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

// Read models de REPORTERÍA (CQRS): panel del tenant, resumen de cliente y export CSV. Derivan
// de cartera/pagos/caja/operación; solo lectura, RLS aísla por tenant.

@Injectable()
export class ReportingQueryRepository {
  async getDashboard(input: {
    tenantId: string;
    currency: string;
  }): Promise<Dashboard> {
    const today = todayIso();
    const dayStart = new Date(`${today}T00:00:00Z`);
    const dayEnd = new Date(`${today}T23:59:59.999Z`);
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [borrowers] = await tx.select({ v: count() }).from(schema.borrower);
      const [active] = await tx
        .select({ v: count() })
        .from(schema.credit)
        .where(eq(schema.credit.status, 'ACTIVE'));

      const [outstanding] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}), 0)`,
        })
        .from(schema.installment)
        .innerJoin(
          schema.credit,
          eq(schema.credit.id, schema.installment.creditId),
        )
        .where(eq(schema.credit.status, 'ACTIVE'));

      const [overdue] = await tx
        .select({
          v: sql<number>`COUNT(DISTINCT ${schema.installment.creditId})`,
        })
        .from(schema.installment)
        .where(
          and(
            sql`${schema.installment.paidMinor} < ${schema.installment.amountDueMinor}`,
            sql`${schema.installment.dueDate} < ${today}`,
          ),
        );

      const [collected] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(${schema.paymentAllocation.amountMinor}), 0)`,
        })
        .from(schema.paymentAllocation)
        .where(
          and(
            gte(schema.paymentAllocation.createdAt, dayStart),
            lte(schema.paymentAllocation.createdAt, dayEnd),
          ),
        );

      const [lent] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(${schema.credit.principalMinor}), 0)`,
        })
        .from(schema.credit)
        .where(
          and(
            gte(schema.credit.createdAt, dayStart),
            lte(schema.credit.createdAt, dayEnd),
          ),
        );

      // Caja actual = liquidez real del libro: Σ saldo de cajas CASH + BANK activas (fuente única).
      const [cash] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(CASE WHEN ${schema.cashTransaction.direction} = 'IN' THEN ${schema.cashTransaction.amountMinor} ELSE -${schema.cashTransaction.amountMinor} END), 0)`,
        })
        .from(schema.cashTransaction)
        .innerJoin(
          schema.cashBox,
          eq(schema.cashBox.id, schema.cashTransaction.cashBoxId),
        )
        .where(
          and(
            inArray(schema.cashBox.type, ['CASH', 'BANK']),
            eq(schema.cashBox.active, true),
          ),
        );

      const [pendingExp] = await tx
        .select({ v: count() })
        .from(schema.expense)
        .where(eq(schema.expense.status, 'PENDING'));
      const [pendingChg] = await tx
        .select({ v: count() })
        .from(schema.changeRequest)
        .where(eq(schema.changeRequest.status, 'PENDING'));

      return {
        currency: input.currency,
        totalBorrowers: Number(borrowers?.v ?? 0),
        activeCredits: Number(active?.v ?? 0),
        overdueAccounts: Number(overdue?.v ?? 0),
        portfolioOutstandingMinor: Number(outstanding?.v ?? 0),
        collectedTodayMinor: Number(collected?.v ?? 0),
        lentTodayMinor: Number(lent?.v ?? 0),
        cashCurrentMinor: Number(cash?.v ?? 0),
        pendingExpenses: Number(pendingExp?.v ?? 0),
        pendingChangeRequests: Number(pendingChg?.v ?? 0),
      };
    });
  }

  async getBorrowerReport(input: {
    tenantId: string;
    borrowerId: string;
  }): Promise<BorrowerReport | null> {
    const today = todayIso();
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [borrower] = await tx
        .select({
          firstName: schema.borrower.firstName,
          lastName: schema.borrower.lastName,
          nationalId: schema.borrower.nationalId,
        })
        .from(schema.borrower)
        .where(eq(schema.borrower.id, input.borrowerId))
        .limit(1);
      if (!borrower) return null;

      // Ventana = el día de hoy (operación diaria; ya no hay liquidación que cierre el período).
      const dayStart = new Date(`${today}T00:00:00Z`);

      const [activeC] = await tx
        .select({ v: count() })
        .from(schema.credit)
        .where(
          and(
            eq(schema.credit.borrowerId, input.borrowerId),
            eq(schema.credit.status, 'ACTIVE'),
          ),
        );
      const [settledC] = await tx
        .select({ v: count() })
        .from(schema.credit)
        .where(
          and(
            eq(schema.credit.borrowerId, input.borrowerId),
            eq(schema.credit.status, 'SETTLED'),
          ),
        );

      const [outstanding] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}), 0)`,
          due: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}) FILTER (WHERE ${schema.installment.dueDate} = ${today}), 0)`,
        })
        .from(schema.installment)
        .innerJoin(
          schema.credit,
          eq(schema.credit.id, schema.installment.creditId),
        )
        .where(eq(schema.credit.borrowerId, input.borrowerId));

      const [paid] = await tx
        .select({
          v: sql<number>`COALESCE(SUM(${schema.paymentAllocation.amountMinor}), 0)`,
        })
        .from(schema.paymentAllocation)
        .innerJoin(
          schema.installment,
          eq(schema.installment.id, schema.paymentAllocation.installmentId),
        )
        .innerJoin(
          schema.credit,
          eq(schema.credit.id, schema.installment.creditId),
        )
        .where(
          and(
            eq(schema.credit.borrowerId, input.borrowerId),
            gte(schema.paymentAllocation.createdAt, dayStart),
          ),
        );

      return {
        borrowerId: input.borrowerId,
        name: fullName(borrower.firstName, borrower.lastName),
        nationalId: borrower.nationalId,
        currency: await resolveTenantCurrency(input.tenantId),
        activeCredits: Number(activeC?.v ?? 0),
        settledCredits: Number(settledC?.v ?? 0),
        outstandingMinor: Number(outstanding?.v ?? 0),
        dueTodayMinor: Number(outstanding?.due ?? 0),
        paidTodayMinor: Number(paid?.v ?? 0),
      };
    });
  }

  async exportAccountsCsv(input: { tenantId: string }): Promise<string> {
    const today = todayIso();
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select({
          firstName: schema.borrower.firstName,
          lastName: schema.borrower.lastName,
          nationalId: schema.borrower.nationalId,
          startDate: schema.credit.startDate,
          endDate: schema.credit.endDate,
          installmentsCount: schema.credit.installmentsCount,
          totalDue: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor}), 0)`,
          totalPaid: sql<number>`COALESCE(SUM(${schema.installment.paidMinor}), 0)`,
          paidCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.installment.paidMinor} >= ${schema.installment.amountDueMinor})`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${schema.installment.paidMinor} < ${schema.installment.amountDueMinor} AND ${schema.installment.dueDate} < ${today})`,
        })
        .from(schema.credit)
        .leftJoin(
          schema.borrower,
          eq(schema.borrower.id, schema.credit.borrowerId),
        )
        .leftJoin(
          schema.installment,
          eq(schema.installment.creditId, schema.credit.id),
        )
        .groupBy(schema.credit.id, schema.borrower.id)
        .orderBy(desc(schema.credit.createdAt));

      const header = [
        'Cedula',
        'Cliente',
        'Fecha',
        'Termina',
        'Cuotas',
        'CtsPagas',
        'DiasAtraso',
        'Valor',
        'Deuda',
      ];
      const lines = rows.map((r) =>
        [
          r.nationalId ?? '',
          fullName(r.firstName, r.lastName) ?? '',
          r.startDate,
          r.endDate,
          String(r.installmentsCount),
          String(Number(r.paidCount)),
          String(Number(r.overdue) > 0 ? 1 : 0),
          toMajor(Number(r.totalDue)),
          toMajor(Number(r.totalDue) - Number(r.totalPaid)),
        ]
          .map(csvCell)
          .join(','),
      );
      return [header.join(','), ...lines].join('\n');
    });
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fullName(first: string | null, last: string | null): string | null {
  const name = `${first ?? ''} ${last ?? ''}`.trim();
  return name.length ? name : null;
}

function toMajor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** Escapa una celda CSV (comillas/comas/saltos de línea). */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
