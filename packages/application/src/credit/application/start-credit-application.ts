import {
  createCreditApplication,
  documentPrompt,
  nextPendingDocument,
  REQUESTED_DOCUMENTS,
} from "@preztiaos/domain";
import type { CreditApplicationStarter, OutboundTextSender } from "../../conversations/text/ports";
import type { ApplicantRef, CreditApplicationRepository } from "./ports";

const INTRO =
  "¡Perfecto! Iniciemos tu solicitud de crédito. Te pediré tres documentos, uno a la vez.";
const RESUME =
  "Ya tienes una solicitud en curso. Continuemos donde quedamos.";

/**
 * Caso de uso: arranca (o retoma) el protocolo de recolección de documentos.
 * Implementa el puerto que el flujo de texto invoca al detectar la intención
 * "ready_to_apply". Es idempotente: si ya hay una solicitud activa, no crea otra,
 * solo recuerda el documento pendiente.
 */
export class StartCreditApplicationHandler implements CreditApplicationStarter {
  constructor(
    private readonly applications: CreditApplicationRepository,
    private readonly sender: OutboundTextSender,
  ) {}

  async start(input: ApplicantRef): Promise<void> {
    const recipient = { channelId: input.channelId, recipient: input.applicant };

    const existing = await this.applications.findActiveByApplicant(input);
    if (existing) {
      const pending = nextPendingDocument(existing.application);
      if (pending) await this.sender.sendText(recipient, `${RESUME} ${documentPrompt(pending)}`);
      return;
    }

    const application = createCreditApplication(REQUESTED_DOCUMENTS);
    await this.applications.create({ applicant: input, application });

    const firstDocument = nextPendingDocument(application);
    // createCreditApplication garantiza al menos un documento pendiente.
    if (firstDocument) {
      await this.sender.sendText(recipient, `${INTRO}\n\n${documentPrompt(firstDocument)}`);
    }
  }
}
