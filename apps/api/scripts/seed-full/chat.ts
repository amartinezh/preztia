import { schema } from '@preztiaos/db';
import type { TenantContext } from './context';

// TRANSCRIPT de WhatsApp/Telegram: espejo de `conversation-message.log` y del deduplicador de
// webhooks. Cada mensaje entrante deja su id en `processed_inbound_message` (idempotencia) y la
// zona que se estampa es la del CANAL por el que llegó, igual que en la API.

export type MessageKind = 'text' | 'image' | 'document' | 'audio' | 'location';

export interface InboundMessage {
  readonly phone: string;
  readonly channelId: string;
  readonly kind: MessageKind;
  readonly body: string | null;
  readonly at: Date;
  readonly mediaId?: string | null;
  readonly mimeType?: string | null;
}

/** Registra un mensaje del cliente; devuelve su id de proveedor (wamid / tg:…). */
export function chatIn(ctx: TenantContext, message: InboundMessage): string {
  const messageId = providerMessageId(ctx, message.channelId);
  ctx.batch.insert(schema.conversationMessage, {
    tenantId: ctx.tenantId,
    channelId: message.channelId,
    applicantPhone: message.phone,
    zonePath: ctx.zonePathByChannel.get(message.channelId) ?? null,
    direction: 'INBOUND',
    kind: message.kind,
    body: message.body,
    mediaId: message.mediaId ?? null,
    mimeType: message.mimeType ?? null,
    messageId,
    createdAt: message.at,
  });
  ctx.batch.insert(schema.processedInboundMessage, {
    tenantId: ctx.tenantId,
    messageId,
    createdAt: message.at,
  });
  ctx.stats.messages += 1;
  return messageId;
}

/** Registra una respuesta del sistema al cliente. */
export function chatOut(
  ctx: TenantContext,
  message: { phone: string; channelId: string; body: string; at: Date },
): void {
  ctx.batch.insert(schema.conversationMessage, {
    tenantId: ctx.tenantId,
    channelId: message.channelId,
    applicantPhone: message.phone,
    zonePath: ctx.zonePathByChannel.get(message.channelId) ?? null,
    direction: 'OUTBOUND',
    kind: 'text',
    body: message.body,
    mediaId: null,
    mimeType: null,
    messageId: null,
    createdAt: message.at,
  });
  ctx.stats.messages += 1;
}

/** Id del media de WhatsApp/Telegram de un adjunto. */
export function mediaId(ctx: TenantContext): string {
  return ctx.random.digits(16);
}

function providerMessageId(ctx: TenantContext, channelId: string): string {
  return channelId.startsWith('tg:')
    ? `${channelId}:${ctx.random.digits(9)}:${ctx.random.digits(6)}`
    : `wamid.HBgM${ctx.random.alphanumeric(40)}`;
}

/** Desplaza un instante unos segundos (respuesta inmediata del sistema). */
export function after(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}
