import { Injectable, Logger } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import { type InboundMessage } from '@preztiaos/domain';
import {
  resolveTenantByChannel,
  resolveZonePathByChannel,
  withTenantTxFor,
} from '../tenancy/unit-of-work';

type Stage = (typeof schema.conversationFailureStage.enumValues)[number];

// El mensaje del error es un diagnóstico para la operación, no un volcado: se trunca para no
// engordar la fila con stacks ni respuestas completas de servicios externos.
const MAX_ERROR_MESSAGE = 500;

// Etapa del flujo según el tipo de mensaje que se estaba atendiendo. Es lo único que se conoce
// con certeza en la frontera del webhook, donde se atrapa el fallo.
const STAGE_BY_KIND: Record<InboundMessage['kind'], Stage> = {
  text: 'ASSISTANT_REPLY',
  image: 'DOCUMENT_INTAKE',
  document: 'DOCUMENT_INTAKE',
  audio: 'AUDIO_INTAKE',
  location: 'LOCATION_CAPTURE',
};

/**
 * Bitácora de los mensajes que NO se pudieron atender por un fallo técnico. Persiste en
 * `conversation_failure` (bajo RLS) lo que antes solo quedaba en los logs del proceso, para que
 * la bandeja pueda distinguir a quien abandonó de quien se quedó a medias porque el sistema
 * falló. Es **best-effort**: si el registro falla, se traga (ya estamos en un camino de error).
 */
@Injectable()
export class ConversationFailureLog {
  private readonly logger = new Logger('Conversations:Failures');

  async record(message: InboundMessage, error: unknown): Promise<void> {
    await this.persist(
      {
        channelId: message.channelId,
        applicantPhone: message.from,
        stage: STAGE_BY_KIND[message.kind] ?? 'UNKNOWN',
        messageKind: message.kind,
        messageId: message.id,
      },
      error,
    );
  }

  /**
   * Fallo técnico al vincular el contacto VERIFICADO de un chat de Telegram (ADR #40). Solo se
   * registra con el teléfono ya verificado como propio: un contacto ajeno o inválido no es un
   * fallo nuestro y no se atribuye a nadie.
   */
  async recordContactVerification(
    input: { channelId: string; applicantPhone: string; messageId: string },
    error: unknown,
  ): Promise<void> {
    await this.persist(
      { ...input, stage: 'CONTACT_VERIFICATION', messageKind: 'contact' },
      error,
    );
  }

  private async persist(
    failure: {
      channelId: string;
      applicantPhone: string;
      stage: Stage;
      messageKind: string;
      messageId: string;
    },
    error: unknown,
  ): Promise<void> {
    try {
      const tenantId = await resolveTenantByChannel(failure.channelId);
      if (!tenantId) return; // canal sin tenant: no hay dónde registrar
      const zonePath = await resolveZonePathByChannel(failure.channelId);
      await withTenantTxFor(tenantId, async (tx) => {
        await tx.insert(schema.conversationFailure).values({
          tenantId,
          ...failure,
          zonePath,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: describe(error),
        });
      });
    } catch (err) {
      this.logger.error(
        `No se pudo registrar el fallo del mensaje ${failure.messageId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}

function describe(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.slice(0, MAX_ERROR_MESSAGE);
}
