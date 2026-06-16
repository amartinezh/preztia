import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  max,
  sql,
  type SQL,
} from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  daysOverdue,
  markOverdue,
  summarizeAccount,
  type PortfolioInstallment,
} from '@preztiaos/domain';
import type { AccountDetail, AccountRow } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

const MILLIS_PER_DAY = 86_400_000;

/**
 * Read model del "Listado de Cuentas" y del "Detalle de préstamo": deriva de la cartera
 * (cuotas) los agregados de cada crédito (deuda, cuotas pagas, días de atraso) y enriquece con
 * el cliente (`borrower`). Solo lectura; RLS aísla por tenant.
 */
export class AccountsQueryRepository {
  async listAccounts(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    name?: string;
    nationalId?: string;
    phone?: string;
    onlyOverdue?: boolean;
  }): Promise<{ items: AccountRow[]; total: number }> {
    const today = todayIso();
    return withTenantTxFor(input.tenantId, async (tx) => {
      const filters: SQL[] = [];
      if (input.name) {
        filters.push(
          ilike(
            sql`${schema.borrower.firstName} || ' ' || ${schema.borrower.lastName}`,
            `%${input.name}%`,
          ),
        );
      }
      if (input.nationalId) {
        filters.push(
          ilike(schema.borrower.nationalId, `%${input.nationalId}%`),
        );
      }
      if (input.phone) {
        filters.push(ilike(schema.borrower.phone, `%${input.phone}%`));
      }
      const where = filters.length ? and(...filters) : undefined;

      const earliestOverdue = sql<
        string | null
      >`MIN(${schema.installment.dueDate}) FILTER (WHERE ${schema.installment.paidMinor} < ${schema.installment.amountDueMinor} AND ${schema.installment.dueDate} < ${today})`;
      const overdueClause = sql`${earliestOverdue} IS NOT NULL`;

      const rows = await tx
        .select({
          creditId: schema.credit.id,
          borrowerId: schema.credit.borrowerId,
          firstName: schema.borrower.firstName,
          lastName: schema.borrower.lastName,
          nationalId: schema.borrower.nationalId,
          zonePath: schema.zone.path,
          startDate: schema.credit.startDate,
          endDate: schema.credit.endDate,
          installmentsCount: schema.credit.installmentsCount,
          currency: schema.credit.currency,
          status: schema.credit.status,
          totalDue: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor}), 0)`,
          totalPaid: sql<number>`COALESCE(SUM(${schema.installment.paidMinor}), 0)`,
          paidCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.installment.paidMinor} >= ${schema.installment.amountDueMinor})`,
          earliestOverdue,
          // "Pago en Fecha": saldo de la(s) cuota(s) que vencen hoy.
          dueToday: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}) FILTER (WHERE ${schema.installment.dueDate} = ${today}), 0)`,
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
        .where(where)
        .groupBy(schema.credit.id, schema.borrower.id, schema.zone.id)
        .having(input.onlyOverdue ? overdueClause : undefined)
        .orderBy(desc(schema.credit.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      // "Sin Liquidar": abonos aplicados después de la última liquidada, por crédito.
      const unsettledByCredit = await this.unsettledByCredit(
        tx,
        rows.map((r) => r.creditId),
      );

      const items: AccountRow[] = rows.map((row) => ({
        creditId: row.creditId,
        borrowerId: row.borrowerId,
        borrowerName: fullName(row.firstName, row.lastName),
        nationalId: row.nationalId ?? null,
        zonePath: row.zonePath ?? null,
        startDate: row.startDate,
        endDate: row.endDate,
        totalDueMinor: Number(row.totalDue),
        installmentsCount: row.installmentsCount,
        paidCount: Number(row.paidCount),
        daysOverdue: daysSince(row.earliestOverdue, today),
        outstandingMinor: Number(row.totalDue) - Number(row.totalPaid),
        unsettledMinor: unsettledByCredit.get(row.creditId) ?? 0,
        dueTodayMinor: Number(row.dueToday),
        currency: row.currency,
        status: row.status,
      }));

      const total = await this.countAccounts(
        tx,
        where,
        input.onlyOverdue,
        today,
      );
      return { items, total };
    });
  }

  async getAccountDetail(input: {
    tenantId: string;
    creditId: string;
  }): Promise<AccountDetail | null> {
    const today = todayIso();
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [credit] = await tx
        .select({
          id: schema.credit.id,
          borrowerId: schema.credit.borrowerId,
          principalMinor: schema.credit.principalMinor,
          interestPct: schema.credit.interestPct,
          installmentsCount: schema.credit.installmentsCount,
          frequency: schema.credit.frequency,
          currency: schema.credit.currency,
          startDate: schema.credit.startDate,
          endDate: schema.credit.endDate,
          status: schema.credit.status,
          firstName: schema.borrower.firstName,
          lastName: schema.borrower.lastName,
          nationalId: schema.borrower.nationalId,
          phone: schema.borrower.phone,
          planName: schema.paymentPlan.name,
        })
        .from(schema.credit)
        .leftJoin(
          schema.borrower,
          eq(schema.borrower.id, schema.credit.borrowerId),
        )
        .leftJoin(
          schema.paymentPlan,
          eq(schema.paymentPlan.id, schema.credit.paymentPlanId),
        )
        .where(eq(schema.credit.id, input.creditId))
        .limit(1);
      if (!credit) return null;

      const rows = await tx
        .select()
        .from(schema.installment)
        .where(eq(schema.installment.creditId, input.creditId))
        .orderBy(asc(schema.installment.seq));

      const installments: PortfolioInstallment[] = rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        dueDate: row.dueDate,
        amountDueMinor: row.amountDueMinor,
        paidMinor: row.paidMinor,
        status: row.status,
      }));
      const summary = summarizeAccount(installments);

      return {
        creditId: credit.id,
        borrowerId: credit.borrowerId,
        borrowerName: fullName(credit.firstName, credit.lastName),
        nationalId: credit.nationalId ?? null,
        phone: credit.phone ?? null,
        planName: credit.planName ?? null,
        principalMinor: credit.principalMinor,
        interestPct: credit.interestPct,
        installmentsCount: credit.installmentsCount,
        frequency: credit.frequency,
        currency: credit.currency,
        startDate: credit.startDate,
        endDate: credit.endDate,
        status: credit.status,
        totalDueMinor: summary.totalDueMinor,
        totalPaidMinor: summary.totalPaidMinor,
        outstandingMinor: summary.outstandingMinor,
        paidCount: summary.paidCount,
        daysOverdue: daysOverdue(installments, today),
        installmentValueMinor: installments[0]?.amountDueMinor ?? 0,
        // El estado de cada cuota refleja el vencimiento al día de hoy (OVERDUE derivado).
        installments: installments.map((i) => {
          const withOverdue = markOverdue(i, today);
          return {
            seq: withOverdue.seq,
            dueDate: withOverdue.dueDate,
            amountDueMinor: withOverdue.amountDueMinor,
            paidMinor: withOverdue.paidMinor,
            status: withOverdue.status,
          };
        }),
      };
    });
  }

  /**
   * Suma, por crédito, los abonos (payment_allocation) aplicados DESPUÉS de la última liquidada
   * del tenant ("Sin Liquidar"). Antes de la primera liquidada, cuenta todo lo abonado.
   */
  private async unsettledByCredit(
    tx: Parameters<Parameters<typeof withTenantTxFor>[1]>[0],
    creditIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (creditIds.length === 0) return result;

    const [lastSettlement] = await tx
      .select({ periodEnd: max(schema.settlement.periodEnd) })
      .from(schema.settlement);
    const cutoff = lastSettlement?.periodEnd ?? null;

    const conditions: SQL[] = [inArray(schema.installment.creditId, creditIds)];
    if (cutoff) conditions.push(gt(schema.paymentAllocation.createdAt, cutoff));

    const rows = await tx
      .select({
        creditId: schema.installment.creditId,
        amount: sql<number>`COALESCE(SUM(${schema.paymentAllocation.amountMinor}), 0)`,
      })
      .from(schema.paymentAllocation)
      .innerJoin(
        schema.installment,
        eq(schema.installment.id, schema.paymentAllocation.installmentId),
      )
      .where(and(...conditions))
      .groupBy(schema.installment.creditId);

    for (const row of rows) result.set(row.creditId, Number(row.amount));
    return result;
  }

  private async countAccounts(
    tx: Parameters<Parameters<typeof withTenantTxFor>[1]>[0],
    where: SQL | undefined,
    onlyOverdue: boolean | undefined,
    today: string,
  ): Promise<number> {
    const having = onlyOverdue
      ? sql`HAVING MIN(${schema.installment.dueDate}) FILTER (WHERE ${schema.installment.paidMinor} < ${schema.installment.amountDueMinor} AND ${schema.installment.dueDate} < ${today}) IS NOT NULL`
      : sql``;
    const result = await tx.execute(sql`
      SELECT count(*)::int AS value FROM (
        SELECT ${schema.credit.id}
        FROM ${schema.credit}
        LEFT JOIN ${schema.borrower} ON ${schema.borrower.id} = ${schema.credit.borrowerId}
        LEFT JOIN ${schema.installment} ON ${schema.installment.creditId} = ${schema.credit.id}
        ${where ? sql`WHERE ${where}` : sql``}
        GROUP BY ${schema.credit.id}
        ${having}
      ) t
    `);
    const first = (result as unknown as Array<{ value: number }>)[0];
    return Number(first?.value ?? 0);
  }
}

function fullName(first: string | null, last: string | null): string | null {
  const name = `${first ?? ''} ${last ?? ''}`.trim();
  return name.length ? name : null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateIso: string | null, today: string): number {
  if (!dateIso) return 0;
  const diff = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dateIso}T00:00:00Z`)) /
      MILLIS_PER_DAY,
  );
  return diff > 0 ? diff : 0;
}
