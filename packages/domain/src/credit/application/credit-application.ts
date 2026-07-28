// Agregado de dominio: la solicitud de crédito como máquina de estados de la
// recolección documental (KYC). Es PURO: sin I/O, sin framework. Cada operación
// devuelve una nueva instancia (inmutabilidad) y preserva los invariantes.

import { ConflictError, DomainError } from "../../shared/money";
import { type FraudAssessment, isAcceptable } from "./fraud";
import { DEFAULT_EXPECTED_FILES, type RequiredDocumentType } from "./required-document";

/** Estado de la solicitud a lo largo del protocolo. */
export type CreditApplicationStatus = "AWAITING_DOCUMENTS" | "IN_REVIEW" | "APPROVED" | "REJECTED";

/**
 * Estado de cada documento dentro de la solicitud.
 * - `PENDING`   → aún no llegó ningún archivo.
 * - `RECEIVED`  → llegaron algunos archivos pero faltan (p. ej. está el anverso, falta el reverso).
 * - `VALIDATED` → se reunieron todos los archivos que el documento exige.
 * - `REJECTED`  → el último envío no se aceptó; se pedirá de nuevo.
 */
export type DocumentStatus = "PENDING" | "RECEIVED" | "VALIDATED" | "REJECTED";

/** Estado de un documento concreto del checklist. */
export interface ApplicationDocument {
  readonly type: RequiredDocumentType;
  readonly status: DocumentStatus;
  /** Archivos que componen el documento (p. ej. 2 = ambos lados). Invariante: ≥ 1. */
  readonly expectedFiles: number;
  /** Archivos ya aceptados. Invariante: 0 ≤ receivedFiles ≤ expectedFiles. */
  readonly receivedFiles: number;
  /**
   * Envíos seguidos que la IA no reconoció como este documento. Se reinicia al validarlo:
   * los intentos son del documento *pendiente*, no un historial perpetuo de la solicitud.
   */
  readonly mismatchAttempts: number;
}

/** Documento solicitado al crear el checklist: qué se pide y de cuántos archivos consta. */
export interface DocumentRequest {
  readonly type: RequiredDocumentType;
  readonly expectedFiles: number;
}

/** Vista inmutable de la solicitud (lo que el dominio razona; la persistencia es de infra). */
export interface CreditApplication {
  readonly status: CreditApplicationStatus;
  readonly documents: readonly ApplicationDocument[];
}

/**
 * Crea una solicitud nueva con el checklist solicitado, todos PENDING.
 * Invariantes: el conjunto de documentos es exactamente `requested` (sin duplicados)
 * y cada documento exige al menos un archivo.
 */
export function createCreditApplication(
  requested: readonly DocumentRequest[],
): CreditApplication {
  if (requested.length === 0) {
    throw new DomainError("Una solicitud debe pedir al menos un documento");
  }
  if (new Set(requested.map((r) => r.type)).size !== requested.length) {
    throw new DomainError("El checklist de documentos no admite duplicados");
  }
  return {
    status: "AWAITING_DOCUMENTS",
    documents: requested.map((request) => ({
      type: request.type,
      status: "PENDING" as const,
      expectedFiles: assertPositiveFiles(request.type, request.expectedFiles),
      receivedFiles: 0,
      mismatchAttempts: 0,
    })),
  };
}

/** Siguiente documento a solicitar: el primero del orden que aún no está VALIDATED. */
export function nextPendingDocument(app: CreditApplication): RequiredDocumentType | null {
  const pending = app.documents.find((doc) => doc.status !== "VALIDATED");
  return pending ? pending.type : null;
}

/** Documento del checklist por su tipo; falla rápido si no pertenece a la solicitud. */
export function documentOf(
  app: CreditApplication,
  type: RequiredDocumentType,
): ApplicationDocument {
  const target = app.documents.find((doc) => doc.type === type);
  if (!target) {
    throw new DomainError(`El documento ${type} no pertenece a esta solicitud`);
  }
  return target;
}

/** Archivos que aún faltan para dar por completo un documento (0 si ya está completo). */
export function pendingFilesOf(app: CreditApplication, type: RequiredDocumentType): number {
  const doc = documentOf(app, type);
  return Math.max(0, doc.expectedFiles - doc.receivedFiles);
}

/** true cuando todos los documentos están VALIDATED. */
export function isComplete(app: CreditApplication): boolean {
  return app.documents.every((doc) => doc.status === "VALIDATED");
}

/**
 * Registra el resultado de revisar un ARCHIVO de un documento.
 * - accepted → suma un archivo; si con él se reúnen todos los que el documento exige pasa a
 *   VALIDATED (y reinicia los intentos), si no queda RECEIVED a la espera del resto.
 * - !accepted → REJECTED y suma un intento fallido; no consume cupo de archivo.
 * - Al completarse el checklist entero, la solicitud pasa a IN_REVIEW.
 *
 * Idempotencia: si el documento ya estaba VALIDATED, se devuelve la solicitud SIN CAMBIOS.
 * Un archivo que llega tarde (el reverso que el solicitante mandó de más, o un webhook
 * reentregado) no degrada el estado NI gasta un intento: no es culpa suya que llegara
 * cuando el documento ya estaba completo.
 */
export function recordDocumentResult(
  app: CreditApplication,
  type: RequiredDocumentType,
  accepted: boolean,
): CreditApplication {
  const target = documentOf(app, type);
  if (target.status === "VALIDATED") return app; // idempotente: ni estado ni intentos

  const documents = app.documents.map((doc) =>
    doc.type === type ? applyResult(doc, accepted) : doc,
  );
  const updated: CreditApplication = { ...app, documents };

  return { ...updated, status: isComplete(updated) ? "IN_REVIEW" : "AWAITING_DOCUMENTS" };
}

/** Transición de un documento al recibir un archivo: cupos y contador de intentos. */
function applyResult(doc: ApplicationDocument, accepted: boolean): ApplicationDocument {
  if (!accepted) {
    return { ...doc, status: "REJECTED", mismatchAttempts: doc.mismatchAttempts + 1 };
  }
  const receivedFiles = Math.min(doc.receivedFiles + 1, doc.expectedFiles);
  const complete = receivedFiles >= doc.expectedFiles;
  return {
    ...doc,
    status: complete ? "VALIDATED" : "RECEIVED",
    receivedFiles,
    // Un archivo válido limpia los intentos: el solicitante ya demostró tener el documento.
    mismatchAttempts: 0,
  };
}

function assertPositiveFiles(type: RequiredDocumentType, expectedFiles: number): number {
  if (!Number.isInteger(expectedFiles) || expectedFiles < DEFAULT_EXPECTED_FILES) {
    throw new DomainError(`El documento ${type} debe exigir al menos un archivo`);
  }
  return expectedFiles;
}

/**
 * Registra el veredicto antifraude estructural de un documento (atajo histórico):
 * acepta si el veredicto es aceptable. La identificación por IA se decide aparte
 * (ver `decideDocumentReview`) y se materializa con `recordDocumentResult`.
 */
export function recordDocumentOutcome(
  app: CreditApplication,
  type: RequiredDocumentType,
  assessment: FraudAssessment,
): CreditApplication {
  return recordDocumentResult(app, type, isAcceptable(assessment));
}

/** Decisión manual del coordinador sobre el expediente completo. */
export type ReviewDecision = "APPROVE" | "REJECT";

const DECISION_TARGET: Record<ReviewDecision, CreditApplicationStatus> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
};

/**
 * Regla pura de la transición manual a nivel de estado: dado el estado actual y la decisión
 * del coordinador, devuelve el estado resultante. Es el único lugar donde vive la regla.
 *
 * - Permitida solo desde estados en curso (`AWAITING_DOCUMENTS`, `IN_REVIEW`): el coordinador
 *   puede aprobar aun cuando un documento marcado dejó la solicitud esperando.
 * - Idempotente: si ya está en el estado destino, lo devuelve sin cambios (doble pulsación o
 *   reintento no rompe nada).
 * - Si ya fue resuelta hacia el OTRO estado terminal, es un conflicto: `DomainError`.
 */
export function nextDecisionStatus(
  current: CreditApplicationStatus,
  decision: ReviewDecision,
): CreditApplicationStatus {
  const target = DECISION_TARGET[decision];
  if (current === target) return current; // idempotente
  if (current === "APPROVED" || current === "REJECTED") {
    throw new ConflictError(
      `La solicitud ya fue resuelta como ${current}; no puede cambiarse a ${target}`,
    );
  }
  return target;
}

/**
 * Resuelve manualmente la solicitud por decisión discrecional del coordinador: la aprueba
 * (para generar el crédito) o la rechaza, aunque el pipeline antifraude la haya marcado como
 * mala. Es una transición de la máquina de estados; el historial de fraude no se altera.
 */
export function decideApplicationReview(
  app: CreditApplication,
  decision: ReviewDecision,
): CreditApplication {
  const status = nextDecisionStatus(app.status, decision);
  return status === app.status ? app : { ...app, status };
}
