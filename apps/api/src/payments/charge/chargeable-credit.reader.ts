import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ChargeableCredit,
  ChargeableCreditReader,
} from '@preztiaos/application';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
  type Tx,
} from '../../tenancy/unit-of-work';

interface ChargeableRow {
  credit_id: string;
  first_name: string;
  currency: string;
  installment_minor: number | string | null;
  overdue_minor: number | string;
}

/**
 * Read model del COBRO CONVERSACIONAL: resuelve el tenant por el canal (el webhook no lo trae) y
 * busca el crédito ACTIVO del teléfono, con la cuota a cobrar (saldo de la cuota impaga más
 * antigua) y todo lo vencido a hoy (misma regla que `dailyDueMinor`). Solo ofrece el cobro si el
 * tenant tiene una cuenta PICPAY activa para generar la cobrança. Solo lectura, bajo `app` + RLS.
 */
@Injectable()
export class ChargeableCreditDrizzleReader implements ChargeableCreditReader {
  async findChargeableByPhone(input: {
    channelId: string;
    phone: string;
  }): Promise<ChargeableCredit | null> {
    const tenantId = await resolveTenantByWhatsappPhone(input.channelId);
    if (!tenantId) return null;

    return withTenantTxFor(tenantId, async (tx) => {
      // Sin proveedor de cobrança configurado no se puede generar el PIX: no se ofrece.
      if (!(await this.hasPicPayProvider(tx))) return null;

      const [row] = (await tx.execute(sql`
        SELECT
          c.id         AS credit_id,
          b.first_name AS first_name,
          c.currency   AS currency,
          (
            SELECT (i2.amount_due_minor - i2.paid_minor)
            FROM installment i2
            WHERE i2.credit_id = c.id AND i2.status <> 'PAID'
            ORDER BY i2.seq
            LIMIT 1
          ) AS installment_minor,
          coalesce(sum(
            CASE WHEN i.due_date <= (now() AT TIME ZONE coalesce(
                   (SELECT collection_reminder_settings->>'timezone' FROM tenant_config WHERE tenant_id = ${tenantId}),
                   'America/Bogota'))::date
                 AND i.status <> 'PAID'
                 THEN i.amount_due_minor - i.paid_minor ELSE 0 END
          ), 0)::bigint AS overdue_minor
        FROM credit c
        JOIN borrower b ON b.id = c.borrower_id
        LEFT JOIN installment i ON i.credit_id = c.id
        WHERE c.status = 'ACTIVE' AND b.phone = ${input.phone}
        GROUP BY c.id, b.first_name, c.currency
        ORDER BY c.start_date DESC
        LIMIT 1
      `)) as unknown as ChargeableRow[];

      if (!row) return null;
      const installmentMinor = Number(row.installment_minor ?? 0);
      const overdueMinor = Number(row.overdue_minor);
      // Sin cuota impaga no hay nada que cobrar.
      if (installmentMinor <= 0) return null;

      return {
        tenantId,
        creditId: row.credit_id,
        firstName: row.first_name,
        installmentMinor,
        // Si nada está vencido aún, "todo lo pendiente" es al menos la cuota (permite prepago).
        overdueMinor: overdueMinor > 0 ? overdueMinor : installmentMinor,
        currency: row.currency,
        provider: 'PICPAY',
      };
    });
  }

  private async hasPicPayProvider(tx: Tx): Promise<boolean> {
    const rows = (await tx.execute(sql`
      SELECT 1
      FROM tenant_bank_account
      WHERE provider_type = 'PICPAY' AND active = true AND verify_payments_enabled = true
      LIMIT 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  }
}
