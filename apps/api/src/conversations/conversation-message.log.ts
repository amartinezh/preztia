import { Injectable, Logger } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import { type ConversationLog } from '@preztiaos/application';
import { type InboundMessage } from '@preztiaos/domain';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
} from '../tenancy/unit-of-work';

interface MessageRow {
  kind: string;
  body: string | null;
  mediaId: string | null;
  mimeType: string | null;
}

/**
 * Adaptador del puerto ConversationLog: persiste el transcript de la conversación en
 * `conversation_message` (bajo RLS). Resuelve el tenant por el phone_number_id del canal.
 * Es **best-effort**: cualquier fallo se registra y se traga; nunca rompe la atención.
 */
@Injectable()
export class ConversationMessageLog implements ConversationLog {
  private readonly logger = new Logger('Conversations:Transcript');

  async recordInbound(message: InboundMessage): Promise<void> {
    const row = describeInbound(message);
    await this.persist({
      channelId: message.channelId,
      applicantPhone: message.from,
      direction: 'INBOUND',
      messageId: message.id,
      ...row,
    });
  }

  async recordOutbound(
    to: { channelId: string; recipient: string },
    body: string,
  ): Promise<void> {
    await this.persist({
      channelId: to.channelId,
      applicantPhone: to.recipient,
      direction: 'OUTBOUND',
      messageId: null,
      kind: 'text',
      body,
      mediaId: null,
      mimeType: null,
    });
  }

  private async persist(input: {
    channelId: string;
    applicantPhone: string;
    direction: 'INBOUND' | 'OUTBOUND';
    messageId: string | null;
    kind: string;
    body: string | null;
    mediaId: string | null;
    mimeType: string | null;
  }): Promise<void> {
    try {
      const tenantId = await resolveTenantByWhatsappPhone(input.channelId);
      if (!tenantId) return; // canal sin tenant: no hay dónde registrar
      await withTenantTxFor(tenantId, async (tx) => {
        await tx.insert(schema.conversationMessage).values({
          tenantId,
          channelId: input.channelId,
          applicantPhone: input.applicantPhone,
          direction: input.direction,
          kind: input.kind,
          body: input.body,
          mediaId: input.mediaId,
          mimeType: input.mimeType,
          messageId: input.messageId,
        });
      });
    } catch (err) {
      this.logger.error(
        `No se pudo registrar el mensaje ${input.direction} de ${input.applicantPhone}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

// Extrae los campos del transcript según el tipo de mensaje entrante.
function describeInbound(message: InboundMessage): MessageRow {
  switch (message.kind) {
    case 'text':
      return {
        kind: 'text',
        body: message.body,
        mediaId: null,
        mimeType: null,
      };
    case 'audio':
      return {
        kind: 'audio',
        body: null,
        mediaId: message.media.mediaId,
        mimeType: message.media.mimeType,
      };
    case 'image':
      return {
        kind: 'image',
        body: message.caption ?? null,
        mediaId: message.media.mediaId,
        mimeType: message.media.mimeType,
      };
    case 'document':
      return {
        kind: 'document',
        body: message.filename ?? null,
        mediaId: message.media.mediaId,
        mimeType: message.media.mimeType,
      };
  }
}
