import type {
  DocumentReviewDecision,
  MediaRef,
  RequiredDocumentSpec,
  RequiredDocumentType,
} from "@preztiaos/domain";
import {
  documentOf,
  findDocumentSpec,
  nextPendingDocument,
  pendingFilesOf,
  recordDocumentResult,
} from "@preztiaos/domain";
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
  LockedCreditApplication,
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

const ALREADY_COMPLETE =
  "Ya tenemos todos tus documentos y tu solicitud está *en revisión*; no necesitas enviar nada más. " +
  "Te avisaremos el resultado.";

/**
 * Caso de uso: recibe un ARCHIVO del solicitante y, según la revisión (antifraude estructural +
 * identificación por IA + intentos previos), decide aceptarlo, pedirlo de nuevo, ofrecer revisión
 * manual o aceptarlo para revisión manual. Solo se almacena lo aceptado (no se gasta espacio en lo
 * inválido). Idempotente por messageId.
 *
 * Un documento puede constar de varios archivos (anverso y reverso): mientras falten, el documento
 * queda a la espera y NO se avanza al siguiente. Todo el tramo leer-decidir-registrar ocurre con la
 * solicitud bloqueada, de modo que un álbum de fotos se procesa en serie y en el orden real.
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

    // Descarga y catálogo van FUERA del cerrojo: no dependen del estado de la solicitud y
    // sostener la transacción durante esa I/O solo alargaría el bloqueo sin ganar nada.
    const media =
      cmd.prepared?.downloaded ?? (await this.downloader.download(cmd.media, cmd.channelId));
    const specs = await this.catalog.listRequested(tenantId);

    const applicant = { tenantId, channelId: cmd.channelId, applicant: cmd.applicant };
    const completedApplicationId = await this.applications.withActiveApplicationLocked(
      applicant,
      (locked) => this.processLocked({ cmd, tenantId, media, specs, locked }),
    );

    // Fuera del cerrojo: el pipeline antifraude consulta fuentes externas y es lento; retenerlo
    // dentro solo serviría para bloquear al solicitante mientras corre.
    if (completedApplicationId) {
      await this.completion.onCompleted({
        tenantId,
        applicationId: completedApplicationId,
        applicant: cmd.applicant,
      });
    }
  }

  /**
   * Tramo crítico, con la solicitud bloqueada: decide el destino del archivo y registra el
   * resultado. Devuelve el id de la solicitud si con este archivo quedó completa.
   */
  private async processLocked(input: {
    cmd: SubmitDocumentCommand;
    tenantId: string;
    media: DownloadedMedia;
    specs: readonly RequiredDocumentSpec[];
    locked: LockedCreditApplication | null;
  }): Promise<string | null> {
    const { cmd, tenantId, media, specs, locked } = input;
    if (!locked) return null; // sin protocolo activo: el archivo no forma parte de una solicitud

    const recipient = { channelId: cmd.channelId, recipient: cmd.applicant };
    const documentType = nextPendingDocument(locked.application);
    if (!documentType) {
      // Llegó cuando ya estaba todo completo (el reverso que sobró, un reenvío tardío). No se
      // registra nada ni se cuenta intento: no es un error del solicitante.
      await this.sender.sendText(recipient, ALREADY_COMPLETE);
      return null;
    }

    const spec = findDocumentSpec(specs, documentType);
    const pending = documentOf(locked.application, documentType);

    // 1) Validar estructuralmente (formato/tamaño/reuso) sobre los metadatos del binario.
    const structural = await this.antifraud.assess({
      tenantId,
      applicationId: locked.id,
      documentType,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      sha256: media.sha256,
    });

    // 2) Revisar: identifica con IA y aplica la regla del dominio con los intentos del agregado.
    const { decision, identifiedType } = await this.reviewer.review(
      {
        tenantId,
        applicationId: locked.id,
        documentType,
        applicantPhone: cmd.applicant,
        mediaId: cmd.media.mediaId,
        ...(spec ? { spec } : {}),
        media,
        priorMismatchAttempts: pending.mismatchAttempts,
      },
      structural,
    );

    const accepted = decision.kind === "accepted" || decision.kind === "accepted_for_manual_review";
    const manualReview = decision.kind === "accepted_for_manual_review";

    // 3) Solo se almacena lo aceptado; lo no aceptado no gasta almacenamiento. El cupo es el
    // siguiente archivo del documento (1 = anverso), lo que evita pisar el ya guardado.
    const slot = pending.receivedFiles + 1;
    const stored = accepted
      ? await this.storage.store({
          tenantId,
          applicationId: locked.id,
          documentType,
          slot,
          media,
        })
      : null;

    // Análisis antifraude por VISIÓN del local: solo para la foto del negocio aceptada. Best-effort
    // (el adaptador traga sus fallos y devuelve null): no debe bloquear la continuidad del checklist.
    if (accepted && documentType === "BUSINESS_PHOTO" && this.businessPhotoVision) {
      await this.businessPhotoVision.analyze({
        tenantId,
        applicationId: locked.id,
        applicantPhone: cmd.applicant,
        mediaId: cmd.media.mediaId,
        photo: media,
      });
    }

    const application = recordDocumentResult(locked.application, documentType, accepted);
    await locked.saveDocumentOutcome({
      tenantId,
      applicationId: locked.id,
      documentType,
      mediaId: cmd.media.mediaId,
      storageKey: stored?.storageKey ?? null,
      mimeType: media.mimeType,
      sha256: media.sha256,
      assessment: structural,
      manualReview,
      application,
    });

    // 4) Responder al solicitante según la decisión (dentro del cerrojo, para que el orden de
    // los mensajes coincida con el orden real de las transiciones).
    if (!accepted) {
      await this.sender.sendText(
        recipient,
        rejectionMessage(decision, identifiedType, documentPrompt(specs, documentType)),
      );
      return null;
    }

    const ack = manualReview
      ? "📝 Archivo recibido y marcado para *revisión manual* de un analista."
      : "✅ Archivo recibido.";

    // Al documento todavía le faltan archivos: se pide el resto en vez de pasar al siguiente.
    const missing = pendingFilesOf(application, documentType);
    if (missing > 0) {
      await this.sender.sendText(recipient, `${ack} ${remainingFilesPrompt(missing)}`);
      return null;
    }

    const next = nextPendingDocument(application);
    if (next) {
      await this.sender.sendText(recipient, `${ack} ${documentPrompt(specs, next)}`);
      return null;
    }

    await this.sender.sendText(recipient, COMPLETED);
    return locked.id;
  }
}

/** Título configurado para pedir un documento; cae al nombre técnico si no hay spec. */
function documentPrompt(
  specs: readonly RequiredDocumentSpec[],
  type: RequiredDocumentType,
): string {
  return findDocumentSpec(specs, type)?.title ?? `Envíame el documento: ${type}.`;
}

/** Pide los archivos que aún faltan del documento en curso (p. ej. el reverso de la cédula). */
function remainingFilesPrompt(missing: number): string {
  return missing === 1
    ? "Falta *1 foto más* de este mismo documento (el otro lado). Envíala, por favor."
    : `Faltan *${missing} fotos más* de este mismo documento. Envíalas, por favor.`;
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
        "Hemos intentado validar tus fotos varias veces y al parecer no son las correctas. " +
        "Si estás seguro de que son las fotos solicitadas, *envíalas una vez más* y las " +
        "remitiremos a un analista de cartera para revisión manual."
      );
  }
}
