import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { chooseProactiveChannel } from '@preztiaos/domain';
import { MessagingChannelsRepository } from '../tenant-config/messaging-channels.repository';
import {
  resolveTenantByChannel,
  withTenantTxFor,
} from '../tenancy/unit-of-work';
import { channelReachableSql } from './channel-reachability.sql';
import { findChannelZone } from './channel-zone';

interface CandidateRow {
  last_inbound_channel: string | null;
  last_inbound_reachable: boolean;
  stored_reachable: boolean;
  zone_whatsapp: string | null;
  zone_telegram: string | null;
  zone_telegram_reachable: boolean;
  legacy_whatsapp: string | null;
}

/**
 * Resuelve el canal por el que se le puede escribir HOY a un cliente en un aviso por iniciativa
 * propia (ADR #40, D8). Parte del canal guardado en el agregado (solicitud, pago), que identifica
 * al tenant y a la zona, reúne los candidatos en UNA consulta bajo RLS y delega la elección en la
 * regla de dominio `chooseProactiveChannel`. `null` si ninguno es alcanzable.
 */
@Injectable()
export class ReachableChannelResolver {
  constructor(private readonly settings: MessagingChannelsRepository) {}

  async resolve(input: {
    storedChannelId: string;
    phone: string;
  }): Promise<string | null> {
    const tenantId = await resolveTenantByChannel(input.storedChannelId);
    if (!tenantId) return null;
    const settings = await this.settings.get(tenantId);

    const row = await withTenantTxFor(tenantId, async (tx) => {
      const zone = await findChannelZone(tx, input.storedChannelId);
      const zoneId = zone?.zoneId ?? null;
      const stored = sql`${input.storedChannelId}::text`;
      const phone = sql`${input.phone}::text`;
      const [candidates] = (await tx.execute(sql`
        SELECT
          li.channel_id AS last_inbound_channel,
          ${channelReachableSql(sql`li.channel_id`, phone)} AS last_inbound_reachable,
          ${channelReachableSql(stored, phone)} AS stored_reachable,
          (SELECT min(w.phone_number_id) FROM whatsapp_channel w
            WHERE w.zone_id = ${zoneId}::uuid) AS zone_whatsapp,
          tc.channel_id AS zone_telegram,
          ${channelReachableSql(sql`tc.channel_id`, phone)} AS zone_telegram_reachable,
          (SELECT whatsapp_phone_number_id FROM tenant_config LIMIT 1) AS legacy_whatsapp
        FROM (SELECT 1) AS one
        LEFT JOIN LATERAL (
          SELECT cm.channel_id FROM conversation_message cm
          WHERE cm.applicant_phone = ${phone} AND cm.direction = 'INBOUND'
          ORDER BY cm.created_at DESC
          LIMIT 1
        ) li ON true
        LEFT JOIN telegram_channel tc ON tc.zone_id = ${zoneId}::uuid
      `)) as unknown as CandidateRow[];
      return candidates;
    });

    return chooseProactiveChannel({
      settings,
      lastInbound: row.last_inbound_channel
        ? {
            channelId: row.last_inbound_channel,
            reachable: row.last_inbound_reachable,
          }
        : null,
      stored: {
        channelId: input.storedChannelId,
        reachable: row.stored_reachable,
      },
      zone: [
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
      ],
      legacyWhatsapp: row.legacy_whatsapp,
    });
  }
}
