import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { channelProviderOf } from '@preztiaos/domain';
import type { Tx } from '../tenancy/unit-of-work';

/** Zona que atiende un canal de mensajería (un número o un bot = una zona). */
export interface ChannelZone {
  readonly zoneId: string;
  readonly zonePath: string;
}

/**
 * Zona del canal `channelId`, leída DENTRO de la transacción del tenant (bajo RLS). Es el único
 * punto que conoce qué tabla de canales corresponde a cada proveedor (ADR #40); los repositorios
 * piden "la zona del canal" sin saber si es WhatsApp o Telegram. `null` si el canal no está mapeado.
 */
export async function findChannelZone(
  tx: Tx,
  channelId: string,
): Promise<ChannelZone | null> {
  if (channelProviderOf(channelId) === 'TELEGRAM') {
    const [bot] = await tx
      .select({
        zoneId: schema.telegramChannel.zoneId,
        zonePath: schema.telegramChannel.zonePath,
      })
      .from(schema.telegramChannel)
      .where(eq(schema.telegramChannel.channelId, channelId))
      .limit(1);
    return bot ?? null;
  }
  const [row] = await tx
    .select({
      zoneId: schema.whatsappChannel.zoneId,
      zonePath: schema.whatsappChannel.zonePath,
    })
    .from(schema.whatsappChannel)
    .where(eq(schema.whatsappChannel.phoneNumberId, channelId))
    .limit(1);
  return row ?? null;
}
