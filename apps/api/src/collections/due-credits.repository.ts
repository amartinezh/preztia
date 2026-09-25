import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  CollectionReminderTarget,
  DueCreditsReader,
} from '@preztiaos/application';
import type { CreditCollectionPanel } from '@preztiaos/contracts';
import {
  channelProviderOf,
  chooseProactiveChannel,
  DEFAULT_MESSAGING_CHANNELS,
  type MessagingChannelsSettings,
} from '@preztiaos/domain';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { channelReachableSql } from '../messaging/channel-reachability.sql';

// Datos de cobranza del tenant resueltos una vez por corrida: zona horaria (para "hoy"), llave PIX,
// número heredado del tenant (respaldo cuando la zona no tiene canal) y proveedores habilitados.
interface TenantCollectionContext {
  asOf: string; // fecha de negocio (ISO YYYY-MM-DD) en la zona horaria del tenant
  pixKey: string | null;
  fallbackChannel: string | null;
  messaging: MessagingChannelsSettings;
}

// Fila cruda del agregado de cartera por crédito (cuota a cobrar a `asOf`).
interface DueCreditRow {
  credit_id: string;
  first_name: string;
  phone: string | null;
  currency: string;
  due_minor: number | string;
  // Candidatos de canal (ADR #40): el último por el que el cliente escribió y los de la zona del
  // crédito, cada uno con su alcanzabilidad calculada en SQL (sin N+1 por cliente).
  last_inbound_channel: string | null;
  last_inbound_reachable: boolean;
  zone_whatsapp: string | null;
  zone_telegram: string | null;
  zone_telegram_reachable: boolean;
}

/**
 * Read model de COBRANZA: traduce la cartera (credit + installment + borrower + canal alcanzable)
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
          // Sin teléfono no hay a quién escribir; sin saldo no hay nada que cobrar. Sin canal
          // alcanzable el objetivo se conserva: el caso de uso lo cuenta como omitido con motivo.
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
        reachableChannel: reachableProvider(row, ctx),
      };
    });
  }

  // Construye el objetivo de envío; null si falta teléfono. Sin canal alcanzable el objetivo SÍ se
  // devuelve (channelId null): el caso de uso lo omite con motivo explícito y queda contado.
  private toTarget(
    row: DueCreditRow,
    ctx: TenantCollectionContext,
  ): CollectionReminderTarget | null {
    if (!row.phone) return null;
    return {
      creditId: row.credit_id,
      firstName: row.first_name,
      phone: row.phone,
      channelId: chooseChannel(row, ctx),
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
        whatsapp_phone_number_id                 AS fallback_channel,
        messaging_channels                       AS messaging
      FROM tenant_config
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `)) as unknown as Array<{
      as_of: string;
      pix_key: string | null;
      fallback_channel: string | null;
      messaging: Partial<MessagingChannelsSettings> | null;
    }>;
    const row = rows[0];
    return {
      // Sin fila de config aún: "hoy" en la zona horaria por defecto.
      asOf: row?.as_of ?? new Date().toISOString().slice(0, 10),
      pixKey: row?.pix_key ?? null,
      fallbackChannel: row?.fallback_channel ?? null,
      // Mezcla sobre los defaults: filas anteriores a la columna quedan en "solo WhatsApp".
      messaging: { ...DEFAULT_MESSAGING_CHANNELS, ...(row?.messaging ?? {}) },
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
      WITH due AS (
        SELECT
          c.id              AS credit_id,
          c.zone_id         AS zone_id,
          b.first_name      AS first_name,
          b.phone           AS phone,
          c.currency        AS currency,
          coalesce(sum(
            CASE WHEN i.due_date <= ${asOf} AND i.status <> 'PAID'
                 THEN i.amount_due_minor - i.paid_minor ELSE 0 END
          ), 0)::bigint     AS due_minor
        FROM credit c
        JOIN borrower b ON b.id = c.borrower_id
        LEFT JOIN installment i ON i.credit_id = c.id
        WHERE c.status = 'ACTIVE' ${creditFilter}
        GROUP BY c.id, c.zone_id, b.first_name, b.phone, c.currency
      )
      SELECT
        due.credit_id, due.first_name, due.phone, due.currency, due.due_minor,
        li.channel_id AS last_inbound_channel,
        ${channelReachableSql(sql`li.channel_id`, sql`due.phone`)} AS last_inbound_reachable,
        (SELECT min(w.phone_number_id) FROM whatsapp_channel w
          WHERE w.zone_id = due.zone_id) AS zone_whatsapp,
        tc.channel_id AS zone_telegram,
        ${channelReachableSql(sql`tc.channel_id`, sql`due.phone`)} AS zone_telegram_reachable
      FROM due
      LEFT JOIN LATERAL (
        SELECT cm.channel_id FROM conversation_message cm
        WHERE cm.applicant_phone = due.phone AND cm.direction = 'INBOUND'
        ORDER BY cm.created_at DESC
        LIMIT 1
      ) li ON true
      LEFT JOIN telegram_channel tc ON tc.zone_id = due.zone_id
    `)) as unknown as DueCreditRow[];
  }
}

/** Canal por el que se le puede escribir al cliente hoy (regla de dominio `chooseProactiveChannel`). */
function chooseChannel(
  row: DueCreditRow,
  ctx: TenantCollectionContext,
): string | null {
  const zone = [
    ...(row.zone_whatsapp
      ? [{ channelId: row.zone_whatsapp, reachable: true }]
      : []),
    ...(row.zone_telegram
      ? [
          {
            channelId: row.zone_telegram,
            reachable: row.zone_telegram_reachable,
          },
        ]
      : []),
  ];
  return chooseProactiveChannel({
    settings: ctx.messaging,
    lastInbound: row.last_inbound_channel
      ? {
          channelId: row.last_inbound_channel,
          reachable: row.last_inbound_reachable,
        }
      : null,
    stored: null,
    zone,
    legacyWhatsapp: ctx.fallbackChannel,
  });
}

function reachableProvider(
  row: DueCreditRow,
  ctx: TenantCollectionContext,
): 'WHATSAPP' | 'TELEGRAM' | null {
  const channelId = row.phone ? chooseChannel(row, ctx) : null;
  return channelId ? channelProviderOf(channelId) : null;
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `••• ${phone.slice(-4)}`;
}
