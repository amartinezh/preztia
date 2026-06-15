// Agregado de dominio: la solicitud de crédito como máquina de estados de la
// recolección documental (KYC). Es PURO: sin I/O, sin framework. Cada operación
// devuelve una nueva instancia (inmutabilidad) y preserva los invariantes.

import { ConflictError, DomainError } from "../../shared/money";
import { type FraudAssessment, isAcceptable } from "./fraud";
import { type RequiredDocumentType } from "./required-document";

/** Estado de la solicitud a lo largo del protocolo. */
export type CreditApplicationStatus = "AWAITING_DOCUMENTS" | "IN_REVIEW" | "APPROVED" | "REJECTED";

/** Estado de cada documento dentro de la solicitud. */
export type DocumentStatus = "PENDING" | "RECEIVED" | "VALIDATED" | "REJECTED";

/** Estado de un documento concreto del checklist. */
export interface ApplicationDocument {
  readonly type: RequiredDocumentType;
  readonly status: DocumentStatus;
}

/** Vista inmutable de la solicitud (lo que el dominio razona; la persistencia es de infra). */
export interface CreditApplication {
  readonly status: CreditApplicationStatus;
  readonly documents: readonly ApplicationDocument[];
}

/**
 * Crea una solicitud nueva con el checklist solicitado, todos PENDING.
 * Invariante: el conjunto de documentos es exactamente `requested` (sin duplicados).
 */
export function createCreditApplication(
  requested: readonly RequiredDocumentType[],
): CreditApplication {
  if (requested.length === 0) {
    throw new DomainError("Una solicitud debe pedir al menos un documento");
  }
  if (new Set(requested).size !== requested.length) {
    throw new DomainError("El checklist de documentos no admite duplicados");
  }
  return {
    status: "AWAITING_DOCUMENTS",
    documents: requested.map((type) => ({ type, status: "PENDING" as const })),
  };
}

/** Siguiente documento a solicitar: el primero del orden que aún no está VALIDATED. */
export function nextPendingDocument(app: CreditApplication): RequiredDocumentType | null {
  const pending = app.documents.find((doc) => doc.status !== "VALIDATED");
  return pending ? pending.type : null;
}

/** true cuando todos los documentos están VALIDATED. */
export function isComplete(app: CreditApplication): boolean {
  return app.documents.every((doc) => doc.status === "VALIDATED");
}

/**
 * Registra el resultado de revisar un documento.
 * - accepted → VALIDATED; si con eso se completa el checklist, la solicitud pasa a IN_REVIEW.
 * - !accepted → REJECTED (se pedirá reenvío); la solicitud sigue AWAITING_DOCUMENTS.
 *
 * Idempotencia: si el documento ya estaba VALIDATED, se devuelve la solicitud sin cambios
 * (un reenvío del mismo o un webhook reentregado no degrada el estado).
 */
export function recordDocumentResult(
  app: CreditApplication,
  type: RequiredDocumentType,
  accepted: boolean,
): CreditApplication {
  const target = app.documents.find((doc) => doc.type === type);
  if (!target) {
    throw new DomainError(`El documento ${type} no pertenece a esta solicitud`);
  }
  if (target.status === "VALIDATED") return app; // idempotente

  const newStatus: DocumentStatus = accepted ? "VALIDATED" : "REJECTED";
  const documents = app.documents.map((doc) =>
    doc.type === type ? { ...doc, status: newStatus } : doc,
  );
  const updated: CreditApplication = { ...app, documents };

  return { ...updated, status: isComplete(updated) ? "IN_REVIEW" : "AWAITING_DOCUMENTS" };
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
