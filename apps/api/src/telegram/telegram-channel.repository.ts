import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { NotFoundError, telegramChannelId } from '@preztiaos/domain';
import { schema } from '@preztiaos/db';
import type {
  TelegramBotIdentity,
  TelegramChannelCredentials,
  TelegramChannelStore,
} from '@preztiaos/application';
import type { TelegramChannel } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { mapUniqueViolation } from '../shared/persistence-errors';
import { decryptSecret, encryptSecret } from '../shared/secret-cipher';

/**
 * Adaptador de `telegram_channel` (bot → zona, ADR #40) bajo el rol `app` + RLS. El zone_path se
 * denormaliza desde la zona elegida. El token del bot y el secret del webhook van CIFRADOS en reposo
 * y NUNCA salen por la API: el listado solo informa el estado (`webhookRegistered`).
 */
@Injectable()
export class TelegramChannelRepository implements TelegramChannelStore {
  async list(tenantId: string): Promise<TelegramChannel[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.telegramChannel)
        .orderBy(desc(schema.telegramChannel.createdAt));
      return rows.map((r) => ({
        id: r.id,
        channelId: r.channelId,
        botId: r.botId,
        botUsername: r.botUsername,
        zoneId: r.zoneId,
        zonePath: r.zonePath,
        webhookRegistered: r.webhookRegisteredAt !== null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async create(input: {
    tenantId: string;
    zoneId: string;
    bot: TelegramBotIdentity;
    botToken: string;
    hookId: string;
    secretToken: string;
  }): Promise<{ id: string }> {
    return mapUniqueViolation(
      () =>
        withTenantTxFor(input.tenantId, async (tx) => {
          const [zone] = await tx
            .select({ path: schema.zone.path })
            .from(schema.zone)
            .where(eq(schema.zone.id, input.zoneId))
            .limit(1);
          if (!zone) throw new NotFoundError('La zona no existe');
          const [created] = await tx
            .insert(schema.telegramChannel)
            .values({
              tenantId: input.tenantId,
              botId: input.bot.botId,
              channelId: telegramChannelId(input.bot.botId),
              botUsername: input.bot.username,
              zoneId: input.zoneId,
              zonePath: zone.path,
              botToken: encryptSecret(input.botToken),
              webhookHookId: input.hookId,
              webhookSecret: encryptSecret(input.secretToken),
            })
            .returning({ id: schema.telegramChannel.id });
          return { id: created.id };
        }),
      'Ese bot ya está vinculado a una zona, o la zona ya tiene un bot de Telegram',
    );
  }

  async findCredentials(input: {
    tenantId: string;
    id: string;
  }): Promise<TelegramChannelCredentials | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          botId: schema.telegramChannel.botId,
          botToken: schema.telegramChannel.botToken,
          hookId: schema.telegramChannel.webhookHookId,
          secret: schema.telegramChannel.webhookSecret,
        })
        .from(schema.telegramChannel)
        .where(eq(schema.telegramChannel.id, input.id))
        .limit(1);
      if (!row) return null;
      return {
        botId: row.botId,
        botToken: decryptSecret(row.botToken),
        hookId: row.hookId,
        secretToken: decryptSecret(row.secret),
      };
    });
  }

  async markWebhookRegistered(input: {
    tenantId: string;
    id: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.telegramChannel)
        .set({ webhookRegisteredAt: new Date() })
        .where(eq(schema.telegramChannel.id, input.id));
    });
  }

  async replaceToken(input: {
    tenantId: string;
    id: string;
    botToken: string;
    username: string | null;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.telegramChannel)
        .set({
          botToken: encryptSecret(input.botToken),
          botUsername: input.username,
        })
        .where(eq(schema.telegramChannel.id, input.id));
    });
  }

  /** Elimina el canal y, en la misma transacción, los vínculos chat⇄teléfono de su bot. */
  async remove(input: { tenantId: string; id: string }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const [deleted] = await tx
        .delete(schema.telegramChannel)
        .where(eq(schema.telegramChannel.id, input.id))
        .returning({ channelId: schema.telegramChannel.channelId });
      if (!deleted) return;
      await tx
        .delete(schema.telegramChatLink)
        .where(
          and(
            eq(schema.telegramChatLink.tenantId, input.tenantId),
            eq(schema.telegramChatLink.channelId, deleted.channelId),
          ),
        );
    });
  }
}
