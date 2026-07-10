import type {
  DocumentReviewDecision,
  MediaRef,
  RequiredDocumentSpec,
  RequiredDocumentType,
} from "@preztiaos/domain";
import { findDocumentSpec, nextPendingDocument, recordDocumentResult } from "@preztiaos/domain";
import type { OutboundTextSender } from "../../conversations/text/ports";
import type {
  AntifraudService,
  ApplicationCompletionNotifier,
  BusinessPhotoVisionAnalyzer,
  CreditApplicationRepository,
  DocumentReviewer,
  DocumentStorage,
  DownloadedMedia,
  InboundMessageDeduplicator,
  MediaDownloader,
  RequiredDocumentCatalog,
  TenantResolver,
} from "./ports";

/** Documento entrante normalizado (imagen o archivo) a procesar en el protocolo. */
export interface SubmitDocumentCommand {
  readonly messageId: string;
  readonly channelId: string;
  readonly applicant: string;
  readonly media: MediaRef;
  /**
   * Presente cuando el enrutador de media ya resolvió tenant, deduplicó y descargó
   * el binario: el handler salta esas etapas para no repetir trabajo ni I/O.
   */
  readonly prepared?: {
    readonly tenantId: string;
    readonly downloaded: DownloadedMedia;
  };
}

const COMPLETED =
  "¡Gracias! Recibimos todos tus documentos. Por último, comparte tu *ubicación* actual con el " +
  "clip 📎 → Ubicación (idealmente desde tu negocio o domicilio) para completar tu solicitud.";

/**
 * Caso de uso: recibe un documento del solicitante y, según la revisión (antifraude
 * estructural + identificación por IA + intentos previos), decide aceptarlo, pedirlo de
 * nuevo, ofrecer revisión manual o aceptarlo para revisión manual. Solo se almacena en
 * MinIO lo aceptado (no se gasta espacio en lo inválido). Idempotente por messageId.
 *
 * No conoce WhatsApp, MinIO, IA ni la BD: solo coordina dominio + puertos.
 */
export class SubmitApplicationDocumentHandler {
  constructor(
    private readonly tenants: TenantResolver,
    private readonly dedup: InboundMessageDeduplicator,
    private readonly applications: CreditApplicationRepository,
    private readonly catalog: RequiredDocumentCatalog,
    private readonly downloader: MediaDownloader,
    private readonly storage: DocumentStorage,
    private readonly antifraud: AntifraudService,
    private readonly sender: OutboundTextSender,
    private readonly completion: ApplicationCompletionNotifier,
    private readonly reviewer: DocumentReviewer,
    // Opcional: análisis antifraude por visión de la foto del local (BUSINESS_PHOTO).
    private readonly businessPhotoVision?: BusinessPhotoVisionAnalyzer,
  ) {}

  async execute(cmd: SubmitDocumentCommand): Promise<void> {
    const tenantId = cmd.prepared?.tenantId ?? (await this.tenants.resolveByChannel(cmd.channelId));
    if (!tenantId) return; // canal no asociado a ningún tenant

    // El enrutador de media ya deduplicó cuando viene `prepared`.
    if (!cmd.prepared && !(await this.dedup.firstSeen({ tenantId, messageId: cmd.messageId }))) {
      return; // ya procesado
    }

    const applicant = { tenantId, channelId: cmd.channelId, applicant: cmd.applicant };
    const active = await this.applications.findActiveByApplicant(applicant);
    if (!active) return; // sin protocolo activo: el archivo no forma parte de una solicitud

    const documentType = nextPendingDocument(active.application);
    if (!documentType) return; // ya estaba completa

    const specs = await this.catalog.listRequested(tenantId);
    const spec = findDocumentSpec(specs, documentType);
    const recipient = { channelId: cmd.channelId, recipient: cmd.applicant };

    // 1) Descargar y validar estructuralmente (formato/tamaño/reuso) sobre los metadatos.
    const media =
      cmd.prepared?.downloaded ?? (await this.downloader.download(cmd.media, cmd.channelId));
    const structural = await this.antifraud.assess({
      tenantId,
      applicationId: active.id,
      documentType,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      sha256: media.sha256,
    });

    // 2) Revisar: identifica con IA, cuenta intentos previos y aplica la regla del dominio.
    const { decision, identifiedType } = await this.reviewer.review(
      {
        tenantId,
        applicationId: active.id,
        documentType,
        applicantPhone: cmd.applicant,
        mediaId: cmd.media.mediaId,
        ...(spec ? { spec } : {}),
        media,
      },
      structural,
    );

    const accepted =
      decision.kind === "accepted" || decision.kind === "accepted_for_manual_review";
    const manualReview = decision.kind === "accepted_for_manual_review";

    // 3) Solo se almacena lo aceptado; lo no aceptado no gasta almacenamiento.
    const stored = accepted
      ? await this.storage.store({ tenantId, applicationId: active.id, documentType, media })
      : null;

    // Análisis antifraude por VISIÓN del local: solo para la foto del negocio aceptada. Best-effort
    // (el adaptador traga sus fallos y devuelve null): no debe bloquear la continuidad del checklist.
    if (accepted && documentType === "BUSINESS_PHOTO" && this.businessPhotoVision) {
      await this.businessPhotoVision.analyze({
        tenantId,
        applicationId: active.id,
        applicantPhone: cmd.applicant,
        mediaId: cmd.media.mediaId,
        photo: media,
      });
    }

    const application = recordDocumentResult(active.application, documentType, accepted);
    await this.applications.saveDocumentOutcome({
      tenantId,
      applicationId: active.id,
      documentType,
      mediaId: cmd.media.mediaId,
      storageKey: stored?.storageKey ?? null,
      mimeType: media.mimeType,
      sha256: media.sha256,
      assessment: structural,
      manualReview,
      application,
    });

    // 4) Responder al solicitante según la decisión.
    if (!accepted) {
      await this.sender.sendText(
        recipient,
        rejectionMessage(decision, identifiedType, documentPrompt(specs, documentType)),
      );
      return;
    }

    const next = nextPendingDocument(application);
    if (next) {
      const ack = manualReview
        ? "📝 Documento recibido y marcado para *revisión manual* de un analista."
        : "✅ Documento recibido.";
      await this.sender.sendText(recipient, `${ack} ${documentPrompt(specs, next)}`);
      return;
    }

    await this.completion.onCompleted({
      tenantId,
      applicationId: active.id,
      applicant: cmd.applicant,
    });
    await this.sender.sendText(recipient, COMPLETED);
  }
}

/** Título configurado para pedir un documento; cae al nombre técnico si no hay spec. */
function documentPrompt(
  specs: readonly RequiredDocumentSpec[],
  type: RequiredDocumentType,
): string {
  return findDocumentSpec(specs, type)?.title ?? `Envíame el documento: ${type}.`;
}

/** Mensaje al solicitante cuando el documento NO se aceptó. */
function rejectionMessage(
  decision: Exclude<
    DocumentReviewDecision,
    { kind: "accepted" } | { kind: "accepted_for_manual_review" }
  >,
  identifiedType: string | null,
  prompt: string,
): string {
  switch (decision.kind) {
    case "structural_reject": {
      const why = decision.reasons.length ? ` (${decision.reasons.join("; ")})` : "";
      return `No pudimos validar el documento${why}. Por favor, reenvíalo. ${prompt}`;
    }
    case "mismatch_retry": {
      const detected = identifiedType ? ` (parece ser: ${identifiedType})` : "";
      return (
        `El documento que enviaste al parecer no es el correcto${detected}. ${prompt} ` +
        `Por favor, envíalo de nuevo. Te ${decision.attemptsLeft === 1 ? "queda" : "quedan"} ` +
        `${decision.attemptsLeft} intento${decision.attemptsLeft === 1 ? "" : "s"} antes de pasarlo a revisión manual.`
      );
    }
    case "offer_manual_review":
      return (
        "Hemos intentado validar tu documento varias veces y al parecer no es el correcto. " +
        "Si estás seguro de que es el documento solicitado, *envíalo una vez más* y lo " +
        "remitiremos a un analista de cartera para revisión manual."
      );
  }
}
