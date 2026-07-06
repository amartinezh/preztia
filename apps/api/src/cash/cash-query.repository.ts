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
  CashDashboardOutput,
  CashTransactionRow,
  DailyReport,
  Expense,
  ExpenseStatus,
  Settlement,
} from '@preztiaos/contracts';
import type { CashTxDirection, CashTxKind } from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Suma firmada de un libro mayor: IN suma, OUT resta. Reutilizada por el dashboard.
const signedSum = sql<number>`COALESCE(SUM(CASE WHEN ${schema.cashTransaction.direction} = 'IN' THEN ${schema.cashTransaction.amountMinor} ELSE -${schema.cashTransaction.amountMinor} END), 0)`;

const ACCOUNT_MASK_VISIBLE_DIGITS = 4;

// Número de cuenta abreviado para la grilla (Nivel 2): nunca exponemos el número completo.
function maskAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.length === 0) return null;
  return `••••${digits.slice(-ACCOUNT_MASK_VISIBLE_DIGITS)}`;
}

// Read models de CAJA: listado de gastos, historial de liquidadas y reporte diario. Solo
// lectura; RLS aísla por tenant. La moneda la resuelve el controlador por tenant (tenant_config).

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

  // Dashboard financiero (Req 5): saldo total + saldo por caja en una sola consulta agrupada
  // (sin N+1). El saldo de cada caja es Σ asientos firmados; el total es Σ de las cajas activas.
  async getCashDashboard(input: {
    tenantId: string;
    currency: string;
  }): Promise<CashDashboardOutput> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.cashBox.id,
          name: schema.cashBox.name,
          type: schema.cashBox.type,
          currency: schema.cashBox.currency,
          bankAccountId: schema.cashBox.bankAccountId,
          bankName: schema.tenantBankAccount.bankName,
          accountNumber: schema.tenantBankAccount.accountNumber,
          assignedTo: schema.cashBox.assignedTo,
          assignedToEmail: schema.appUser.email,
          balanceMinor: signedSum,
        })
        .from(schema.cashBox)
        .leftJoin(
          schema.cashTransaction,
          eq(schema.cashTransaction.cashBoxId, schema.cashBox.id),
        )
        .leftJoin(
          schema.tenantBankAccount,
          eq(schema.tenantBankAccount.id, schema.cashBox.bankAccountId),
        )
        .leftJoin(
          schema.appUser,
          eq(schema.appUser.id, schema.cashBox.assignedTo),
        )
        .where(eq(schema.cashBox.active, true))
        .groupBy(
          schema.cashBox.id,
          schema.tenantBankAccount.bankName,
          schema.tenantBankAccount.accountNumber,
          schema.appUser.email,
        );

      // Última conciliación por caja (la más reciente): para resaltar descuadres (Req 7).
      const recRows = await tx
        .selectDistinctOn([schema.bankReconciliation.cashBoxId], {
          cashBoxId: schema.bankReconciliation.cashBoxId,
          status: schema.bankReconciliation.status,
          differenceMinor: schema.bankReconciliation.differenceMinor,
          bankMinor: schema.bankReconciliation.bankMinor,
          createdAt: schema.bankReconciliation.createdAt,
        })
        .from(schema.bankReconciliation)
        .orderBy(
          schema.bankReconciliation.cashBoxId,
          desc(schema.bankReconciliation.createdAt),
        );
      const lastByBox = new Map(
        recRows.map((r) => [
          r.cashBoxId,
          {
            status: r.status,
            differenceMinor: r.differenceMinor,
            bankMinor: r.bankMinor,
            syncedAt: r.createdAt.toISOString(),
          },
        ]),
      );

      // Último arqueo por caja: una caja de ruta con efectivo que no se arqueó hoy
      // requiere cierre urgente (el cobrador debe rendir cuentas del dinero que carga).
      const countRows = await tx
        .selectDistinctOn([schema.cashCount.cashBoxId], {
          cashBoxId: schema.cashCount.cashBoxId,
          createdAt: schema.cashCount.createdAt,
        })
        .from(schema.cashCount)
        .orderBy(schema.cashCount.cashBoxId, desc(schema.cashCount.createdAt));
      const lastCountByBox = new Map(
        countRows.map((r) => [r.cashBoxId, r.createdAt]),
      );
      const todayStart = new Date(
        `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
      );

      const boxes = rows.map((row) => {
        const balanceMinor = Number(row.balanceMinor ?? 0);
        const lastCount = lastCountByBox.get(row.id) ?? null;
        const isRouteBox = row.type === 'CASH' && row.assignedTo !== null;
        const needsClose =
          isRouteBox &&
          balanceMinor > 0 &&
          (lastCount === null || lastCount < todayStart);
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          currency: row.currency,
          balanceMinor,
          bankAccountId: row.bankAccountId,
          bankName: row.bankName ?? null,
          accountNumberMasked: maskAccountNumber(row.accountNumber),
          assignedTo: row.assignedTo,
          assignedToEmail: row.assignedToEmail ?? null,
          needsClose,
          lastReconciliation: lastByBox.get(row.id) ?? null,
        };
      });

      const sumByType = (type: (typeof boxes)[number]['type']): number =>
        boxes
          .filter((b) => b.type === type)
          .reduce((acc, b) => acc + b.balanceMinor, 0);

      const totalMinor = boxes.reduce((acc, b) => acc + b.balanceMinor, 0);
      const cashTotalMinor = sumByType('CASH');
      const bankTotalMinor = sumByType('BANK');
      // Liquidez = efectivo + bancos; el tránsito se reporta aparte como alerta.
      const liquidityTotalMinor = cashTotalMinor + bankTotalMinor;
      const unidentifiedMinor = sumByType('TRANSIT');

      return {
        totalMinor,
        cashTotalMinor,
        bankTotalMinor,
        liquidityTotalMinor,
        currency: input.currency,
        boxes,
        unidentifiedMinor,
      };
    });
  }

  // Historial detallado de movimientos con filtros (Req 5). Paginado; RLS aísla por tenant.
  async listCashTransactions(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    cashBoxId?: string;
    kind?: CashTxKind;
    direction?: CashTxDirection;
    userId?: string;
    collectorId?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: CashTransactionRow[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const conds: SQL[] = [];
      if (input.cashBoxId)
        conds.push(eq(schema.cashTransaction.cashBoxId, input.cashBoxId));
      if (input.kind) conds.push(eq(schema.cashTransaction.kind, input.kind));
      if (input.direction)
        conds.push(eq(schema.cashTransaction.direction, input.direction));
      if (input.userId)
        conds.push(eq(schema.cashTransaction.createdBy, input.userId));
      // Cobrador dueño de la caja: filtra por el efectivo de su ruta (vía cash_box.assigned_to).
      if (input.collectorId)
        conds.push(eq(schema.cashBox.assignedTo, input.collectorId));
      if (input.from)
        conds.push(gte(schema.cashTransaction.createdAt, new Date(input.from)));
      if (input.to)
        conds.push(lte(schema.cashTransaction.createdAt, new Date(input.to)));
      const where = conds.length ? and(...conds) : undefined;

      // El join 1:1 con cash_box permite filtrar por su dueño sin alterar el conteo.
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.cashTransaction)
        .innerJoin(
          schema.cashBox,
          eq(schema.cashBox.id, schema.cashTransaction.cashBoxId),
        )
        .where(where);

      const rows = await tx
        .select({
          id: schema.cashTransaction.id,
          cashBoxId: schema.cashTransaction.cashBoxId,
          boxName: schema.cashBox.name,
          direction: schema.cashTransaction.direction,
          kind: schema.cashTransaction.kind,
          amountMinor: schema.cashTransaction.amountMinor,
          currency: schema.cashTransaction.currency,
          reason: schema.cashTransaction.reason,
          paymentId: schema.cashTransaction.paymentId,
          transferGroupId: schema.cashTransaction.transferGroupId,
          createdBy: schema.cashTransaction.createdBy,
          createdAt: schema.cashTransaction.createdAt,
        })
        .from(schema.cashTransaction)
        .innerJoin(
          schema.cashBox,
          eq(schema.cashBox.id, schema.cashTransaction.cashBoxId),
        )
        .where(where)
        .orderBy(desc(schema.cashTransaction.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const items: CashTransactionRow[] = rows.map((row) => ({
        id: row.id,
        cashBoxId: row.cashBoxId,
        boxName: row.boxName,
        direction: row.direction,
        kind: row.kind,
        amountMinor: row.amountMinor,
        currency: row.currency,
        reason: row.reason,
        paymentId: row.paymentId,
        transferGroupId: row.transferGroupId,
        createdBy: row.createdBy,
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
