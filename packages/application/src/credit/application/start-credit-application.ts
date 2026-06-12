import {
  createCreditApplication,
  findDocumentSpec,
  nextPendingDocument,
} from "@preztiaos/domain";
import type {
  CreditApplicationRestarter,
  CreditApplicationStarter,
  OutboundTextSender,
} from "../../conversations/text/ports";
import type { ApplicantRef, CreditApplicationRepository, RequiredDocumentCatalog } from "./ports";

const INTRO =
  "¡Perfecto! Iniciemos tu solicitud de crédito. Te pediré los documentos requeridos, uno a la vez.";
const RESUME = "Ya tienes una solicitud en curso. Continuemos donde quedamos.";
const ALREADY_SUBMITTED =
  "Ya recibimos todos tus documentos y tu solicitud está *en revisión*; te avisaremos el resultado. " +
  "Si necesitas enviarlos de nuevo, escribe: *quiero ingresar nuevamente los documentos*.";
const RESTART =
  "¡Listo! Reiniciamos tu solicitud. Te pediré nuevamente todos los documentos, uno a la vez.";

/**
 * Caso de uso: arranca (o retoma) el protocolo de recolección de documentos.
 * Implementa el puerto que el flujo de texto invoca al detectar la intención
 * "credit_application". Es idempotente: si ya hay una solicitud activa, no crea otra,
 * solo recuerda el documento pendiente.
 *
 * El conjunto de documentos, su orden y los textos del chat provienen del catálogo
 * del tenant; este caso de uso no conoce cuáles son ni cómo se piden.
 */
export class StartCreditApplicationHandler
  implements CreditApplicationStarter, CreditApplicationRestarter
{
  constructor(
    private readonly applications: CreditApplicationRepository,
    private readonly sender: OutboundTextSender,
    private readonly catalog: RequiredDocumentCatalog,
  ) {}

  async start(input: ApplicantRef): Promise<void> {
    const recipient = { channelId: input.channelId, recipient: input.applicant };

    const specs = await this.catalog.listRequested(input.tenantId);
    if (specs.length === 0) return; // tenant sin documentos configurados: nada que pedir

    const existing = await this.applications.findActiveByApplicant(input);
    if (existing) {
      const pending = nextPendingDocument(existing.application);
      const spec = pending ? findDocumentSpec(specs, pending) : undefined;
      // Con documento pendiente, retomamos; ya completa (en revisión), lo informamos
      // y orientamos al reinicio para que el usuario nunca se quede sin respuesta.
      await this.sender.sendText(recipient, spec ? `${RESUME} ${spec.title}` : ALREADY_SUBMITTED);
      return;
    }

    const application = createCreditApplication(specs.map((spec) => spec.key));
    await this.applications.create({ applicant: input, application });

    const firstDocument = nextPendingDocument(application);
    // createCreditApplication garantiza al menos un documento pendiente.
    const firstSpec = firstDocument ? findDocumentSpec(specs, firstDocument) : undefined;
    if (firstSpec) {
      await this.sender.sendText(recipient, `${INTRO}\n\n${firstSpec.title}`);
    }
  }

  async restart(input: ApplicantRef): Promise<void> {
    const recipient = { channelId: input.channelId, recipient: input.applicant };

    const specs = await this.catalog.listRequested(input.tenantId);
    if (specs.length === 0) return; // tenant sin documentos configurados

    const existing = await this.applications.findActiveByApplicant(input);
    if (!existing) {
      // No hay nada que reiniciar: equivale a iniciar una solicitud nueva.
      await this.start(input);
      return;
    }

    await this.applications.reset({ tenantId: input.tenantId, applicationId: existing.id });

    // Tras reiniciar, el primer documento del catálogo es el primero pendiente.
    const [firstSpec] = specs;
    if (firstSpec) {
      await this.sender.sendText(recipient, `${RESTART}\n\n${firstSpec.title}`);
    }
  }
}
