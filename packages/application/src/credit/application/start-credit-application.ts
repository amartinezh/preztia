import {
  clientMessagesFor,
  createCreditApplication,
  findDocumentSpec,
  nextPendingDocument,
} from "@preztiaos/domain";
import type {
  ClientLanguageResolver,
  CreditApplicationRestarter,
  CreditApplicationStarter,
  OutboundTextSender,
} from "../../conversations/text/ports";
import type { ApplicantRef, CreditApplicationRepository, RequiredDocumentCatalog } from "./ports";

/**
 * Caso de uso: arranca (o retoma) el protocolo de recolección de documentos.
 * Implementa el puerto que el flujo de texto invoca al detectar la intención
 * "credit_application". Es idempotente: si ya hay una solicitud activa, no crea otra,
 * solo recuerda el documento pendiente.
 *
 * El conjunto de documentos, su orden y los textos del chat provienen del catálogo
 * del tenant; este caso de uso no conoce cuáles son ni cómo se piden. Los textos fijos
 * salen del diccionario del idioma del tenant.
 */
export class StartCreditApplicationHandler
  implements CreditApplicationStarter, CreditApplicationRestarter
{
  constructor(
    private readonly applications: CreditApplicationRepository,
    private readonly sender: OutboundTextSender,
    private readonly catalog: RequiredDocumentCatalog,
    private readonly languages: ClientLanguageResolver,
  ) {}

  async start(input: ApplicantRef): Promise<void> {
    const recipient = { channelId: input.channelId, recipient: input.applicant };

    const specs = await this.catalog.listRequested(input.tenantId);
    if (specs.length === 0) return; // tenant sin documentos configurados: nada que pedir

    const messages = clientMessagesFor(await this.languages.byTenant(input.tenantId)).application;
    const existing = await this.applications.findActiveByApplicant(input);
    if (existing) {
      const pending = nextPendingDocument(existing.application);
      const spec = pending ? findDocumentSpec(specs, pending) : undefined;
      // Con documento pendiente, retomamos; ya completa (en revisión), lo informamos
      // y orientamos al reinicio para que el usuario nunca se quede sin respuesta.
      await this.sender.sendText(
        recipient,
        spec ? `${messages.resume} ${spec.title}` : messages.alreadySubmitted,
      );
      return;
    }

    // El checklist congela cuántos archivos exige cada documento: cambiar el catálogo
    // después no debe alterar expedientes ya en curso.
    const application = createCreditApplication(
      specs.map((spec) => ({ type: spec.key, expectedFiles: spec.expectedFiles })),
    );
    await this.applications.create({ applicant: input, application });

    // Primer paso del flujo: preguntar el monto. Al responderlo, `RecordAmountReplyHandler`
    // registra el valor y pide el primer documento.
    await this.sender.sendText(recipient, `${messages.intro}\n\n${messages.amountQuestion}`);
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
      const messages = clientMessagesFor(await this.languages.byTenant(input.tenantId)).application;
      await this.sender.sendText(recipient, `${messages.restart}\n\n${firstSpec.title}`);
    }
  }
}
