import type {
  CreditApplication,
  FraudAssessment,
  MediaRef,
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
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sha256: string;
  readonly assessment: FraudAssessment;
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
   * Persiste el resultado de un documento: inserta/actualiza la fila del documento,
   * actualiza el estado de la solicitud y registra el evento de auditoría, todo en
   * la misma transacción.
   */
  saveDocumentOutcome(outcome: DocumentOutcome): Promise<void>;
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

/** Puerto: idempotencia de webhooks — registra el mensaje y dice si es la primera vez. */
export interface InboundMessageDeduplicator {
  /** true si el mensaje no se había procesado antes (y queda registrado). */
  firstSeen(input: { tenantId: string; messageId: string }): Promise<boolean>;
}

/** Puerto: resuelve el tenant a partir del canal (phone_number_id) del webhook. */
export interface TenantResolver {
  resolveByChannel(channelId: string): Promise<string | null>;
}
