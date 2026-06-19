import { parseRequestedAmountMinor } from "@preztiaos/domain";
import type { TextMessage } from "@preztiaos/domain";

import type { OutboundTextSender } from "../../conversations/text/ports";
import type { InboundMessageDeduplicator, RequiredDocumentCatalog } from "./ports";

const AMOUNT_OK = "¡Gracias! Anotamos tu monto. Ahora te pediré los documentos requeridos, uno a la vez.";
const AMOUNT_REASK =
  "No entendí el monto. Por favor responde solo con el número que deseas solicitar (ej. 300000).";

/** Solicitud que está a la espera del monto (recién iniciada, sin monto aún). */
export interface AwaitingAmountApplication {
  readonly tenantId: string;
  readonly applicationId: string;
}

/** Persistencia mínima para la captura del monto por WhatsApp (bajo RLS, resuelve tenant por canal). */
export interface AmountCaptureStore {
  /** Solicitud activa del solicitante a la espera del monto; `null` si no hay ninguna. */
  findAwaitingAmount(input: {
    channelId: string;
    applicant: string;
  }): Promise<AwaitingAmountApplication | null>;

  /** Sella el monto solicitado en la solicitud (idempotente: solo si seguía sin monto). */
  recordAmount(input: {
    tenantId: string;
    applicationId: string;
    amountMinor: number;
  }): Promise<void>;
}

/**
 * Caso de uso (webhook): captura el monto que el cliente declara querer solicitar. Se ejecuta
 * ANTES del asistente: si el solicitante tiene una solicitud recién iniciada sin monto, su próximo
 * texto se interpreta como el monto; si no, devuelve `false` y el mensaje sigue su curso. Tras
 * registrar el monto, pide el primer documento. Idempotente por wamid. No conoce HTTP ni BD.
 */
export class RecordAmountReplyHandler {
  constructor(
    private readonly store: AmountCaptureStore,
    private readonly catalog: RequiredDocumentCatalog,
    private readonly sender: OutboundTextSender,
    private readonly dedup: InboundMessageDeduplicator,
  ) {}

  /** @returns `true` si el mensaje se atendió como captura de monto (no debe ir al asistente). */
  async handle(message: TextMessage): Promise<boolean> {
    const awaiting = await this.store.findAwaitingAmount({
      channelId: message.channelId,
      applicant: message.from,
    });
    if (!awaiting) return false;

    if (!(await this.dedup.firstSeen({ tenantId: awaiting.tenantId, messageId: message.id }))) {
      return true;
    }

    const recipient = { channelId: message.channelId, recipient: message.from };
    const amountMinor = parseRequestedAmountMinor(message.body);
    if (amountMinor === null) {
      await this.sender.sendText(recipient, AMOUNT_REASK);
      return true;
    }

    await this.store.recordAmount({
      tenantId: awaiting.tenantId,
      applicationId: awaiting.applicationId,
      amountMinor,
    });

    // Tras el monto, arranca la recolección documental con el primer documento del catálogo.
    const specs = await this.catalog.listRequested(awaiting.tenantId);
    const first = specs[0];
    await this.sender.sendText(recipient, first ? `${AMOUNT_OK}\n\n${first.title}` : AMOUNT_OK);
    return true;
  }
}
