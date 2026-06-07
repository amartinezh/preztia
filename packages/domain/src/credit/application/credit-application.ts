// Agregado de dominio: la solicitud de crédito como máquina de estados de la
// recolección documental (KYC). Es PURO: sin I/O, sin framework. Cada operación
// devuelve una nueva instancia (inmutabilidad) y preserva los invariantes.

import { DomainError } from "../../shared/money";
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
 * Registra el veredicto antifraude de un documento.
 * - approved → VALIDATED; si con eso se completa el checklist, la solicitud pasa a IN_REVIEW.
 * - suspicious/rejected → REJECTED (se pedirá reenvío); la solicitud sigue AWAITING_DOCUMENTS.
 *
 * Idempotencia: si el documento ya estaba VALIDATED, se devuelve la solicitud sin cambios
 * (un reenvío del mismo o un webhook reentregado no degrada el estado).
 */
export function recordDocumentOutcome(
  app: CreditApplication,
  type: RequiredDocumentType,
  assessment: FraudAssessment,
): CreditApplication {
  const target = app.documents.find((doc) => doc.type === type);
  if (!target) {
    throw new DomainError(`El documento ${type} no pertenece a esta solicitud`);
  }
  if (target.status === "VALIDATED") return app; // idempotente

  const newStatus: DocumentStatus = isAcceptable(assessment) ? "VALIDATED" : "REJECTED";
  const documents = app.documents.map((doc) =>
    doc.type === type ? { ...doc, status: newStatus } : doc,
  );
  const updated: CreditApplication = { ...app, documents };

  return { ...updated, status: isComplete(updated) ? "IN_REVIEW" : "AWAITING_DOCUMENTS" };
}
