import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gt,
  lte,
  sql,
  type AnyColumn,
} from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  NewSettlement,
  SettlementStore,
  WindowTotals,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Adaptador del puerto SettlementStore: lee la última liquidada, calcula los totales de la
// ventana (movimientos de caja) y persiste el cierre. Opera bajo el rol `app` + RLS.
@Injectable()
export class SettlementDrizzleRepository implements SettlementStore {
  async findLast(
    tenantId: string,
  ): Promise<{ cajaActualMinor: number; periodEnd: Date } | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          cajaActualMinor: schema.settlement.cajaActualMinor,
          periodEnd: schema.settlement.periodEnd,
        })
        .from(schema.settlement)
        .orderBy(desc(schema.settlement.createdAt))
        .limit(1);
      return row
        ? { cajaActualMinor: row.cajaActualMinor, periodEnd: row.periodEnd }
        : null;
    });
  }

  async computeWindowTotals(input: {
    tenantId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<WindowTotals> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const inWindow = (col: AnyColumn) =>
        and(gt(col, input.periodStart), lte(col, input.periodEnd));

      const [cobrado] = await tx
        .select({
          value: sql<number>`COALESCE(SUM(${schema.paymentAllocation.amountMinor}), 0)`,
        })
        .from(schema.paymentAllocation)
        .where(inWindow(schema.paymentAllocation.createdAt));

      const [prestado] = await tx
        .select({
          value: sql<number>`COALESCE(SUM(${schema.credit.principalMinor}), 0)`,
          nuevas: count(),
        })
        .from(schema.credit)
        .where(inWindow(schema.credit.createdAt));

      const [gastos] = await tx
        .select({
          value: sql<number>`COALESCE(SUM(${schema.expense.amountMinor}), 0)`,
        })
        .from(schema.expense)
        .where(
          and(
            eq(schema.expense.status, 'APPROVED'),
            gt(schema.expense.reviewedAt, input.periodStart),
            lte(schema.expense.reviewedAt, input.periodEnd),
          ),
        );

      // Cuentas terminadas: créditos con un abono en la ventana que quedaron sin saldo.
      const terminadas = await tx.execute(sql`
        SELECT count(*)::int AS value FROM (
          SELECT i.credit_id
          FROM ${schema.paymentAllocation} pa
          JOIN ${schema.installment} i ON i.id = pa.installment_id
          WHERE pa.created_at > ${input.periodStart.toISOString()}::timestamptz AND pa.created_at <= ${input.periodEnd.toISOString()}::timestamptz
          GROUP BY i.credit_id
          HAVING (
            SELECT COALESCE(SUM(ii.amount_due_minor - ii.paid_minor), 0)
            FROM ${schema.installment} ii WHERE ii.credit_id = i.credit_id
          ) = 0
        ) t
      `);
      const cuentasTerminadas = Number(
        (terminadas as unknown as Array<{ value: number }>)[0]?.value ?? 0,
      );

      return {
        totalCobradoMinor: Number(cobrado?.value ?? 0),
        totalPrestadoMinor: Number(prestado?.value ?? 0),
        gastosMinor: Number(gastos?.value ?? 0),
        cuentasNuevas: Number(prestado?.nuevas ?? 0),
        cuentasTerminadas,
      };
    });
  }

  async create(settlement: NewSettlement): Promise<void> {
    await withTenantTxFor(settlement.tenantId, async (tx) => {
      await tx.insert(schema.settlement).values({
        id: settlement.id,
        tenantId: settlement.tenantId,
        closedBy: settlement.closedBy,
        periodStart: settlement.periodStart,
        periodEnd: settlement.periodEnd,
        cajaAnteriorMinor: settlement.cajaAnteriorMinor,
        totalCobradoMinor: settlement.totalCobradoMinor,
        totalPrestadoMinor: settlement.totalPrestadoMinor,
        gastosMinor: settlement.gastosMinor,
        cajaActualMinor: settlement.cajaActualMinor,
        cuentasNuevas: settlement.cuentasNuevas,
        cuentasTerminadas: settlement.cuentasTerminadas,
      });
    });
  }
}
