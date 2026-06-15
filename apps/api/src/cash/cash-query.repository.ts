import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  DailyReport,
  Expense,
  ExpenseStatus,
  Settlement,
} from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read models de CAJA: listado de gastos, historial de liquidadas y reporte diario. Solo
// lectura; RLS aísla por tenant. La moneda del tenant la fija el despliegue (CREDIT_CURRENCY).

@Injectable()
export class CashQueryRepository {
  async listExpenses(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    status?: ExpenseStatus;
  }): Promise<{ items: Expense[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = input.status
        ? eq(schema.expense.status, input.status)
        : undefined;
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.expense)
        .where(where);
      const rows = await tx
        .select()
        .from(schema.expense)
        .where(where)
        .orderBy(desc(schema.expense.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const items: Expense[] = rows.map((row) => ({
        id: row.id,
        requestedBy: row.requestedBy,
        description: row.description,
        amountMinor: row.amountMinor,
        status: row.status,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  async listSettlements(input: {
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: Settlement[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.settlement);
      const rows = await tx
        .select()
        .from(schema.settlement)
        .orderBy(desc(schema.settlement.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const items: Settlement[] = rows.map((row) => ({
        id: row.id,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        cajaAnteriorMinor: row.cajaAnteriorMinor,
        totalCobradoMinor: row.totalCobradoMinor,
        totalPrestadoMinor: row.totalPrestadoMinor,
        gastosMinor: row.gastosMinor,
        cajaActualMinor: row.cajaActualMinor,
        cuentasNuevas: row.cuentasNuevas,
        cuentasTerminadas: row.cuentasTerminadas,
        createdAt: row.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  async getDailyReport(input: {
    tenantId: string;
    date: string;
    currency: string;
  }): Promise<DailyReport> {
    const dayStart = new Date(`${input.date}T00:00:00Z`);
    const dayEnd = new Date(`${input.date}T23:59:59.999Z`);
    const within = (col: AnyColumn): SQL =>
      and(gte(col, dayStart), lte(col, dayEnd)) as SQL;

    return withTenantTxFor(input.tenantId, async (tx) => {
      const [cobrado] = await tx
        .select({
          value: sql<number>`COALESCE(SUM(${schema.paymentAllocation.amountMinor}), 0)`,
          clients: sql<number>`COUNT(DISTINCT ${schema.installment.creditId})`,
        })
        .from(schema.paymentAllocation)
        .innerJoin(
          schema.installment,
          eq(schema.installment.id, schema.paymentAllocation.installmentId),
        )
        .where(within(schema.paymentAllocation.createdAt));

      const [prestado] = await tx
        .select({
          value: sql<number>`COALESCE(SUM(${schema.credit.principalMinor}), 0)`,
        })
        .from(schema.credit)
        .where(within(schema.credit.createdAt));

      const [gastos] = await tx
        .select({
          value: sql<number>`COALESCE(SUM(${schema.expense.amountMinor}), 0)`,
        })
        .from(schema.expense)
        .where(
          and(
            eq(schema.expense.status, 'APPROVED'),
            within(schema.expense.reviewedAt),
          ),
        );

      const [active] = await tx
        .select({ value: count() })
        .from(schema.credit)
        .where(eq(schema.credit.status, 'ACTIVE'));

      const [pending] = await tx
        .select({ value: count() })
        .from(schema.expense)
        .where(eq(schema.expense.status, 'PENDING'));

      const totalCobradoMinor = Number(cobrado?.value ?? 0);
      const totalPrestadoMinor = Number(prestado?.value ?? 0);
      const gastosMinor = Number(gastos?.value ?? 0);
      return {
        date: input.date,
        currency: input.currency,
        totalCobradoMinor,
        totalPrestadoMinor,
        gastosMinor,
        cajaDelDiaMinor: totalCobradoMinor - totalPrestadoMinor - gastosMinor,
        clientsWithPayments: Number(cobrado?.clients ?? 0),
        activeCredits: Number(active?.value ?? 0),
        pendingExpenses: Number(pending?.value ?? 0),
      };
    });
  }
}
