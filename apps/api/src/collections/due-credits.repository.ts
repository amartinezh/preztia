import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  CollectionReminderTarget,
  DueCreditsReader,
} from '@preztiaos/application';
import type { CreditCollectionPanel } from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';

// Datos de cobranza del tenant resueltos una vez por corrida: zona horaria (para "hoy"), llave PIX
// y número del tenant como canal de respaldo (cuando la zona del crédito no tiene canal propio).
interface TenantCollectionContext {
  asOf: string; // fecha de negocio (ISO YYYY-MM-DD) en la zona horaria del tenant
  pixKey: string | null;
  fallbackChannel: string | null;
}

// Fila cruda del agregado de cartera por crédito (cuota a cobrar a `asOf`).
interface DueCreditRow {
  credit_id: string;
  first_name: string;
  phone: string | null;
  zone_channel: string | null;
  currency: string;
  due_minor: number | string;
}

/**
 * Read model de COBRANZA: traduce la cartera (credit + installment + borrower + canal de la zona)
 * a objetivos de cobro "a hoy" en la zona horaria del tenant. Solo lectura, bajo el rol `app` + RLS
 * (todo va dentro de `withTenantTxFor`, así que PostgreSQL aísla al tenant). La cuota del día se
 * calcula en SQL (rendimiento del lote) con la MISMA regla que el dominio `dailyDueMinor`:
 * suma del saldo (due − paid) de las cuotas vencidas/vigentes a la fecha y no saldadas.
 */
@Injectable()
export class DueCreditsRepository implements DueCreditsReader {
  async listDue(tenantId: string): Promise<CollectionReminderTarget[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const ctx = await this.loadContext(tx, tenantId);
      const rows = await this.queryDueCredits(tx, ctx.asOf, null);
      return (
        rows
          .map((row) => this.toTarget(row, ctx))
          // Sin teléfono o sin canal no se puede enviar; sin saldo no hay nada que cobrar.
          .filter(
            (t): t is CollectionReminderTarget => t !== null && t.dueMinor > 0,
          )
      );
    });
  }

  async findDueCredit(input: {
    tenantId: string;
    creditId: string;
  }): Promise<CollectionReminderTarget | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const ctx = await this.loadContext(tx, input.tenantId);
      const [row] = await this.queryDueCredits(tx, ctx.asOf, input.creditId);
      if (!row) return null;
      return this.toTarget(row, ctx);
    });
  }

  /** Panel de cobranza para la vista de Cartera (incluye créditos sin teléfono o sin saldo). */
  async getPanel(input: {
    tenantId: string;
    creditId: string;
  }): Promise<CreditCollectionPanel | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const ctx = await this.loadContext(tx, input.tenantId);
      const [row] = await this.queryDueCredits(tx, ctx.asOf, input.creditId);
      if (!row) return null;
      return {
        creditId: row.credit_id,
        firstName: row.first_name,
        phone: row.phone,
        phoneMasked: row.phone ? maskPhone(row.phone) : null,
        dueMinor: Number(row.due_minor),
        currency: row.currency,
        pixConfigured: ctx.pixKey !== null && ctx.pixKey.length > 0,
      };
    });
  }

  // Construye el objetivo de envío; null si falta teléfono o canal (no es enviable).
  private toTarget(
    row: DueCreditRow,
    ctx: TenantCollectionContext,
  ): CollectionReminderTarget | null {
    const channelId = row.zone_channel ?? ctx.fallbackChannel;
    if (!row.phone || !channelId) return null;
    return {
      creditId: row.credit_id,
      firstName: row.first_name,
      phone: row.phone,
      channelId,
      dueMinor: Number(row.due_minor),
      currency: row.currency,
      pixKey: ctx.pixKey,
      asOfDate: ctx.asOf,
    };
  }

  private async loadContext(
    tx: Tx,
    tenantId: string,
  ): Promise<TenantCollectionContext> {
    const rows = (await tx.execute(sql`
      SELECT
        (now() AT TIME ZONE coalesce(collection_reminder_settings->>'timezone', 'America/Bogota'))::date::text AS as_of,
        collection_reminder_settings->>'pixKey'  AS pix_key,
        whatsapp_phone_number_id                 AS fallback_channel
      FROM tenant_config
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `)) as unknown as Array<{
      as_of: string;
      pix_key: string | null;
      fallback_channel: string | null;
    }>;
    const row = rows[0];
    return {
      // Sin fila de config aún: "hoy" en la zona horaria por defecto.
      asOf: row?.as_of ?? new Date().toISOString().slice(0, 10),
      pixKey: row?.pix_key ?? null,
      fallbackChannel: row?.fallback_channel ?? null,
    };
  }

  // Agregado por crédito activo: suma el saldo de las cuotas vencidas/vigentes a `asOf` y no
  // saldadas. Con `creditId` filtra uno; sin él, todos los créditos activos del tenant.
  private async queryDueCredits(
    tx: Tx,
    asOf: string,
    creditId: string | null,
  ): Promise<DueCreditRow[]> {
    const creditFilter = creditId ? sql`AND c.id = ${creditId}` : sql``;
    return (await tx.execute(sql`
      SELECT
        c.id              AS credit_id,
        b.first_name      AS first_name,
        b.phone           AS phone,
        wc.phone_number_id AS zone_channel,
        c.currency        AS currency,
        coalesce(sum(
          CASE WHEN i.due_date <= ${asOf} AND i.status <> 'PAID'
               THEN i.amount_due_minor - i.paid_minor ELSE 0 END
        ), 0)::bigint     AS due_minor
      FROM credit c
      JOIN borrower b ON b.id = c.borrower_id
      LEFT JOIN whatsapp_channel wc ON wc.zone_id = c.zone_id
      LEFT JOIN installment i ON i.credit_id = c.id
      WHERE c.status = 'ACTIVE' ${creditFilter}
      GROUP BY c.id, b.first_name, b.phone, wc.phone_number_id, c.currency
    `)) as unknown as DueCreditRow[];
  }
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `••• ${phone.slice(-4)}`;
}
