import type {
  CreditApplication,
  DocumentReviewDecision,
  FraudAssessment,
  MediaRef,
  RequiredDocumentSpec,
  RequiredDocumentType,
} from "@preztiaos/domain";

// Puertos de salida del slice de solicitud de crédito. La infraestructura provee
// la implementación concreta de cada uno (Drizzle, Graph API, MinIO, antifraude).

/** Identifica al solicitante dentro de un tenant y canal de WhatsApp. */
export interface ApplicantRef {
  readonly tenantId: string;
  /** phone_number_id del negocio (canal). */
  readonly channelId: string;
  /** teléfono del solicitante (E.164 sin '+'). */
  readonly applicant: string;
}

/** Solicitud activa recuperada de persistencia: el agregado de dominio + su id. */
export interface ActiveCreditApplication {
  readonly id: string;
  readonly application: CreditApplication;
}

/** Binario de un documento ya descargado del proveedor. */
export interface DownloadedMedia {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** hash del contenido; clave para deduplicar y para antifraude. */
  readonly sha256: string;
}

/** Ubicación del documento ya almacenado de forma segura. */
export interface StoredDocument {
  /** clave de objeto en el almacenamiento (MinIO). */
  readonly storageKey: string;
  readonly sha256: string;
}

/** Datos de un documento persistido junto al veredicto antifraude. */
export interface DocumentOutcome {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly documentType: RequiredDocumentType;
  readonly mediaId: string;
  /** clave de almacenamiento; null cuando el documento fue rechazado y NO se guardó. */
  readonly storageKey: string | null;
  readonly mimeType: string;
  readonly sha256: string;
  readonly assessment: FraudAssessment;
  /** true si se aceptó por insistencia y queda marcado para revisión manual. */
  readonly manualReview: boolean;
  /** estado resultante del agregado tras registrar este documento. */
  readonly application: CreditApplication;
}

/** Puerto: persistencia de la solicitud de crédito y sus documentos (bajo RLS). */
export interface CreditApplicationRepository {
  /** Devuelve la solicitud activa del solicitante, o null si no hay ninguna. */
  findActiveByApplicant(applicant: ApplicantRef): Promise<ActiveCreditApplication | null>;
  /** Crea una solicitud nueva y devuelve su id. */
  create(input: { applicant: ApplicantRef; application: CreditApplication }): Promise<string>;
  /**
   * Reinicia una solicitud: vuelve todos sus documentos a PENDING (limpiando los datos
   * KYC previos) y la solicitud a AWAITING_DOCUMENTS, registrando el evento de auditoría.
   */
  reset(input: { tenantId: string; applicationId: string }): Promise<void>;
  /**
   * Persiste el resultado de un documento: inserta/actualiza la fila del documento,
   * actualiza el estado de la solicitud y registra el evento de auditoría, todo en
   * la misma transacción.
   */
  saveDocumentOutcome(outcome: DocumentOutcome): Promise<void>;
}

/**
 * Puerto: catálogo de documentos requeridos por tenant. Es la fuente de qué
 * documentos se piden, en qué orden y con qué título/descripción. La infraestructura
 * lo lee de la tabla `credit_document_requirement` bajo RLS.
 */
export interface RequiredDocumentCatalog {
  /** Documentos requeridos activos del tenant, en el orden en que se solicitan. */
  listRequested(tenantId: string): Promise<readonly RequiredDocumentSpec[]>;
}

/**
 * Puerto: se invoca cuando una solicitud reúne TODOS sus documentos (completitud).
 * Hoy solo deja constancia (observabilidad); más adelante disparará el siguiente
 * paso del flujo (revisión, notificaciones, colas).
 */
export interface ApplicationCompletionNotifier {
  onCompleted(input: {
    tenantId: string;
    applicationId: string;
    /** teléfono del solicitante (E.164 sin '+'). */
    applicant: string;
  }): Promise<void>;
}

/** Puerto: descarga el binario de un media desde el proveedor (Graph API). */
export interface MediaDownloader {
  download(media: MediaRef): Promise<DownloadedMedia>;
}

/** Puerto: almacena el documento de forma segura (cifrado en reposo). */
export interface DocumentStorage {
  store(input: {
    tenantId: string;
    applicationId: string;
    documentType: RequiredDocumentType;
    media: DownloadedMedia;
  }): Promise<StoredDocument>;
}

/** Contexto que el servicio antifraude evalúa para un documento. */
export interface AntifraudInput {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly documentType: RequiredDocumentType;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** Puerto: servicio antifraude que valida un documento entrante. */
export interface AntifraudService {
  assess(input: AntifraudInput): Promise<FraudAssessment>;
}

/** Contexto del documento entrante a revisar (lo que la IA necesita para identificarlo). */
export interface DocumentReviewJob {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly documentType: RequiredDocumentType;
  /** teléfono (E.164 sin '+') desde el que se envió el documento. */
  readonly applicantPhone: string;
  readonly mediaId: string;
  /** especificación del catálogo (título/descripción, caso Brasil) para guiar a la IA. */
  readonly spec?: RequiredDocumentSpec;
  /** binario ya descargado del documento. */
  readonly media: DownloadedMedia;
}

/** Resultado de revisar el documento: la decisión (dominio) + contexto para el mensaje. */
export interface DocumentReviewResult {
  readonly decision: DocumentReviewDecision;
  /** qué identificó la IA (texto libre), o null si no lo reconoció / no se ejecutó. */
  readonly identifiedType: string | null;
}

/**
 * Puerto: revisa un documento entrante. La implementación (1) cuenta cuántas veces el
 * documento ya no coincidió, (2) lo identifica con IA y persiste la extracción para
 * trazabilidad (best-effort), y (3) aplica la regla `decideDocumentReview` del dominio
 * con el máximo de intentos configurado. El proveedor de IA es configurable por tenant.
 */
export interface DocumentReviewer {
  review(job: DocumentReviewJob, structural: FraudAssessment): Promise<DocumentReviewResult>;
}

/** Puerto: idempotencia de webhooks — registra el mensaje y dice si es la primera vez. */
export interface InboundMessageDeduplicator {
  /** true si el mensaje no se había procesado antes (y queda registrado). */
  firstSeen(input: { tenantId: string; messageId: string }): Promise<boolean>;
}

/** Puerto: resuelve el tenant a partir del canal (phone_number_id) del webhook. */
export interface TenantResolver {
  resolveByChannel(channelId: string): Promise<string | null>;
}
