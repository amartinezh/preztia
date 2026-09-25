import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  TelegramChatLinkStore,
  TelegramChatRef,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Dígitos del teléfono que se conservan en la auditoría (el resto es PII).
const PHONE_VISIBLE_DIGITS = 4;

/**
 * Adaptador de `telegram_chat_link` (chat de Telegram ⇄ teléfono verificado, ADR #40) bajo el rol
 * `app` + RLS. Solo guarda el chat_id y el teléfono: ni nombre ni username (minimización de PII).
 */
@Injectable()
export class TelegramChatLinkRepository implements TelegramChatLinkStore {
  async openChat(chat: TelegramChatRef): Promise<{ phone: string | null }> {
    return withTenantTxFor(chat.tenantId, async (tx) => {
      const now = new Date();
      // Upsert: registra el chat nuevo; si ya existía, que escriba de nuevo levanta el bloqueo.
      const [row] = await tx
        .insert(schema.telegramChatLink)
        .values({
          tenantId: chat.tenantId,
          channelId: chat.channelId,
          chatId: chat.chatId,
        })
        .onConflictDoUpdate({
          target: [
            schema.telegramChatLink.channelId,
            schema.telegramChatLink.chatId,
          ],
          set: { blockedAt: null, updatedAt: now },
        })
        .returning({ phone: schema.telegramChatLink.phone });
      return { phone: row?.phone ?? null };
    });
  }

  /**
   * Chat vinculado al teléfono verificado en este bot (para enviarle mensajes), o `null` si ese
   * teléfono nunca compartió su contacto con el bot. Informa si el usuario bloqueó el bot.
   */
  async chatForPhone(input: {
    tenantId: string;
    channelId: string;
    phone: string;
  }): Promise<{ chatId: string; blocked: boolean } | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          chatId: schema.telegramChatLink.chatId,
          blockedAt: schema.telegramChatLink.blockedAt,
        })
        .from(schema.telegramChatLink)
        .where(
          and(
            eq(schema.telegramChatLink.channelId, input.channelId),
            eq(schema.telegramChatLink.phone, input.phone),
          ),
        )
        .limit(1);
      return row
        ? { chatId: row.chatId, blocked: row.blockedAt !== null }
        : null;
    });
  }

  /** El usuario bloqueó el bot (403 al enviar): no se le vuelve a escribir hasta que regrese. */
  async markBlocked(input: {
    tenantId: string;
    channelId: string;
    chatId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const now = new Date();
      await tx
        .update(schema.telegramChatLink)
        .set({ blockedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.telegramChatLink.channelId, input.channelId),
            eq(schema.telegramChatLink.chatId, input.chatId),
          ),
        );
    });
  }

  async linkPhone(input: TelegramChatRef & { phone: string }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const now = new Date();
      // El último contacto verificado gana: se retira el teléfono de cualquier otro chat del bot
      // ANTES de asignarlo (índice único parcial por canal + teléfono).
      const replaced = await tx
        .update(schema.telegramChatLink)
        .set({ phone: null, verifiedAt: null, updatedAt: now })
        .where(
          and(
            eq(schema.telegramChatLink.channelId, input.channelId),
            eq(schema.telegramChatLink.phone, input.phone),
            ne(schema.telegramChatLink.chatId, input.chatId),
          ),
        )
        .returning({ chatId: schema.telegramChatLink.chatId });
      const [link] = await tx
        .insert(schema.telegramChatLink)
        .values({
          tenantId: input.tenantId,
          channelId: input.channelId,
          chatId: input.chatId,
          phone: input.phone,
          verifiedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.telegramChatLink.channelId,
            schema.telegramChatLink.chatId,
          ],
          set: {
            phone: input.phone,
            verifiedAt: now,
            blockedAt: null,
            updatedAt: now,
          },
        })
        .returning({ id: schema.telegramChatLink.id });
      // Vincular un teléfono a un chat es un cambio de IDENTIDAD: queda en el audit log
      // append-only en la misma transacción. Sin el teléfono completo (PII).
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: null,
        action: 'VERIFY telegram-contact',
        entity: 'telegram-chat-link',
        entityId: link?.id ?? null,
        payload: {
          channelId: input.channelId,
          chatId: input.chatId,
          phoneLast4: input.phone.slice(-PHONE_VISIBLE_DIGITS),
          replacedChats: replaced.map((r) => r.chatId),
        },
      });
    });
  }
}
