import { Injectable } from '@nestjs/common';
import { asc, inArray, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  dailyDueMinor,
  overdueBalanceMinor,
  summarizeAccount,
  type PortfolioInstallment,
} from '@preztiaos/domain';
import type {
  BorrowerAccount,
  BorrowerAccountMovement,
  BorrowerAccountReader,
  BorrowerCredit,
} from '@preztiaos/application';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
  type Tx,
} from '../../tenancy/unit-of-work';

/** Cuántos abonos recientes se listan por crédito (mensaje de WhatsApp acotado). */
const RECENT_MOVEMENTS_LIMIT = 6;

/** Zona horaria por defecto para resolver la fecha de negocio (mora) si el tenant no la configuró. */
const DEFAULT_TIMEZONE = 'America/Bogota';

interface CreditRow {
  credit_id: string;
  first_name: string;
  currency: string;
  start_date: string;
  today: string;
}

interface MovementRow {
  credit_id: string;
  date: string;
  amount_minor: number | string;
}

/**
 * Read model de la CONSULTA DE CUENTA por WhatsApp: resuelve el tenant por el canal (el webhook no
 * lo trae) y busca TODOS los créditos ACTIVOS del teléfono (un cliente puede tener varios, otorgados
 * por WhatsApp o por el panel). Deriva del dominio los agregados de cada crédito (saldo, abonado,
 * mora) y lista sus abonos recientes. Solo lectura, bajo el rol `app` + RLS. La fecha de negocio
 * (para la mora) se calcula en la zona horaria del tenant, igual que el cobro conversacional.
 */
@Injectable()
export class BorrowerAccountDrizzleReader implements BorrowerAccountReader {
  async findAccountByPhone(input: {
    channelId: string;
    phone: string;
  }): Promise<BorrowerAccount | null> {
    const tenantId = await resolveTenantByWhatsappPhone(input.channelId);
    if (!tenantId) return null;

    return withTenantTxFor(tenantId, async (tx) => {
      const creditRows = (await tx.execute(sql`
        SELECT
          c.id            AS credit_id,
          b.first_name    AS first_name,
          c.currency      AS currency,
          c.start_date::text AS start_date,
          (now() AT TIME ZONE coalesce(
            (SELECT collection_reminder_settings->>'timezone' FROM tenant_config WHERE tenant_id = ${tenantId}),
            ${DEFAULT_TIMEZONE}))::date::text AS today
        FROM credit c
        JOIN borrower b ON b.id = c.borrower_id
        WHERE c.status = 'ACTIVE' AND b.phone = ${input.phone}
        ORDER BY c.start_date DESC
      `)) as unknown as CreditRow[];
      if (creditRows.length === 0) return null;

      const creditIds = creditRows.map((row) => row.credit_id);
      const today = creditRows[0].today;
      const installmentsByCredit = await this.installmentsByCredit(
        tx,
        creditIds,
      );
      const movementsByCredit = await this.movementsByCredit(tx, creditIds);

      const credits: BorrowerCredit[] = creditRows.map((row) => {
        const installments = installmentsByCredit.get(row.credit_id) ?? [];
        const summary = summarizeAccount(installments);
        return {
          startDate: row.start_date,
          totalDueMinor: summary.totalDueMinor,
          totalPaidMinor: summary.totalPaidMinor,
          outstandingMinor: summary.outstandingMinor,
          dueTodayMinor: dailyDueMinor(installments, today),
          overdueMinor: overdueBalanceMinor(installments, today),
          movements: movementsByCredit.get(row.credit_id) ?? [],
        };
      });

      return {
        tenantId,
        firstName: creditRows[0].first_name,
        currency: creditRows[0].currency,
        credits,
      };
    });
  }

  /** Cuotas de todos los créditos en una sola consulta, agrupadas por crédito. */
  private async installmentsByCredit(
    tx: Tx,
    creditIds: string[],
  ): Promise<Map<string, PortfolioInstallment[]>> {
    const rows = await tx
      .select({
        creditId: schema.installment.creditId,
        id: schema.installment.id,
        seq: schema.installment.seq,
        dueDate: schema.installment.dueDate,
        amountDueMinor: schema.installment.amountDueMinor,
        paidMinor: schema.installment.paidMinor,
        status: schema.installment.status,
      })
      .from(schema.installment)
      .where(inArray(schema.installment.creditId, creditIds))
      .orderBy(asc(schema.installment.creditId), asc(schema.installment.seq));

    const map = new Map<string, PortfolioInstallment[]>();
    for (const row of rows) {
      const list = map.get(row.creditId) ?? [];
      list.push({
        id: row.id,
        seq: row.seq,
        dueDate: row.dueDate,
        amountDueMinor: row.amountDueMinor,
        paidMinor: row.paidMinor,
        status: row.status,
      });
      map.set(row.creditId, list);
    }
    return map;
  }

  /**
   * Abonos recientes por crédito = pagos con su monto realmente aplicado a cuotas
   * (`payment_allocation`), del más reciente al más antiguo. Así el listado cuadra con "Abonado"
   * (Σ abonos = totalPaidMinor) y excluye comprobantes rechazados o sin conciliar. Una sola consulta
   * para todos los créditos; se limita a los más recientes por crédito en memoria.
   */
  private async movementsByCredit(
    tx: Tx,
    creditIds: string[],
  ): Promise<Map<string, BorrowerAccountMovement[]>> {
    const idList = sql.join(
      creditIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const rows = (await tx.execute(sql`
      SELECT
        p.credit_id AS credit_id,
        to_char((coalesce(p.paid_at, p.created_at) AT TIME ZONE coalesce(
          (SELECT collection_reminder_settings->>'timezone' FROM tenant_config WHERE tenant_id = p.tenant_id),
          ${DEFAULT_TIMEZONE}))::date, 'YYYY-MM-DD') AS date,
        coalesce(sum(a.amount_minor), 0)::bigint AS amount_minor
      FROM payment p
      JOIN payment_allocation a ON a.payment_id = p.id
      WHERE p.credit_id IN (${idList})
      GROUP BY p.id, p.credit_id, p.paid_at, p.created_at
      ORDER BY coalesce(p.paid_at, p.created_at) DESC
    `)) as unknown as MovementRow[];

    const map = new Map<string, BorrowerAccountMovement[]>();
    for (const row of rows) {
      const list = map.get(row.credit_id) ?? [];
      if (list.length < RECENT_MOVEMENTS_LIMIT) {
        list.push({ date: row.date, amountMinor: Number(row.amount_minor) });
        map.set(row.credit_id, list);
      }
    }
    return map;
  }
}
