import type { MediaRef } from "@preztiaos/domain";
import { isAcceptable, documentPrompt, nextPendingDocument, recordDocumentOutcome } from "@preztiaos/domain";
import type { OutboundTextSender } from "../../conversations/text/ports";
import type {
  AntifraudService,
  CreditApplicationRepository,
  DocumentStorage,
  InboundMessageDeduplicator,
  MediaDownloader,
  TenantResolver,
} from "./ports";

/** Documento entrante normalizado (imagen o archivo) a procesar en el protocolo. */
export interface SubmitDocumentCommand {
  readonly messageId: string;
  readonly channelId: string;
  readonly applicant: string;
  readonly media: MediaRef;
}

const COMPLETED =
  "¡Gracias! Recibimos todos tus documentos. Tu solicitud está *en revisión*; te avisaremos el resultado.";

/**
 * Caso de uso: recibe un documento del solicitante, lo almacena, lo valida con el
 * servicio antifraude y avanza el protocolo. Idempotente ante reentrega de webhooks
 * (dedup por messageId). Si no hay solicitud activa, ignora el archivo.
 *
 * No conoce WhatsApp, MinIO ni la BD: solo coordina dominio + puertos.
 */
export class SubmitApplicationDocumentHandler {
  constructor(
    private readonly tenants: TenantResolver,
    private readonly dedup: InboundMessageDeduplicator,
    private readonly applications: CreditApplicationRepository,
    private readonly downloader: MediaDownloader,
    private readonly storage: DocumentStorage,
    private readonly antifraud: AntifraudService,
    private readonly sender: OutboundTextSender,
  ) {}

  async execute(cmd: SubmitDocumentCommand): Promise<void> {
    const tenantId = await this.tenants.resolveByChannel(cmd.channelId);
    if (!tenantId) return; // canal no asociado a ningún tenant

    if (!(await this.dedup.firstSeen({ tenantId, messageId: cmd.messageId }))) return; // ya procesado

    const applicant = { tenantId, channelId: cmd.channelId, applicant: cmd.applicant };
    const active = await this.applications.findActiveByApplicant(applicant);
    if (!active) return; // sin protocolo activo: el archivo no forma parte de una solicitud

    const documentType = nextPendingDocument(active.application);
    if (!documentType) return; // ya estaba completa

    const recipient = { channelId: cmd.channelId, recipient: cmd.applicant };

    const media = await this.downloader.download(cmd.media);
    const stored = await this.storage.store({
      tenantId,
      applicationId: active.id,
      documentType,
      media,
    });
    const assessment = await this.antifraud.assess({
      tenantId,
      applicationId: active.id,
      documentType,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      sha256: media.sha256,
    });

    const application = recordDocumentOutcome(active.application, documentType, assessment);
    await this.applications.saveDocumentOutcome({
      tenantId,
      applicationId: active.id,
      documentType,
      mediaId: cmd.media.mediaId,
      storageKey: stored.storageKey,
      mimeType: media.mimeType,
      sha256: media.sha256,
      assessment,
      application,
    });

    if (!isAcceptable(assessment)) {
      const why = assessment.reasons.length ? ` (${assessment.reasons.join("; ")})` : "";
      await this.sender.sendText(
        recipient,
        `No pudimos validar el documento${why}. Por favor, reenvíalo. ${documentPrompt(documentType)}`,
      );
      return;
    }

    const next = nextPendingDocument(application);
    await this.sender.sendText(
      recipient,
      next ? `✅ Documento recibido. ${documentPrompt(next)}` : COMPLETED,
    );
  }
}
