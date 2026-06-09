// Regla de negocio PURA para decidir qué hacer con un documento recién recibido,
// combinando: (1) el veredicto antifraude estructural, (2) la identificación de la IA
// (¿es el documento que se pidió y se reconoció con claridad?) y (3) cuántas veces
// el solicitante ya envió un documento que no corresponde.
//
// No conoce IA, BD ni HTTP: recibe datos ya resueltos por la infraestructura y devuelve
// la decisión. Así el comportamiento es testeable y tiene una sola razón para cambiar.

import { type FraudAssessment, isAcceptable } from "./fraud";

/** Veredicto de la IA sobre un documento, ya normalizado a dos señales de negocio. */
export interface DocumentIdentification {
  /** La IA reconoció que es el documento que se pidió. */
  readonly matchesExpected: boolean;
  /** La IA identificó el documento con claridad (confianza suficiente). */
  readonly clearlyIdentified: boolean;
}

/** Decisión sobre el documento recibido. */
export type DocumentReviewDecision =
  /** Estructural y de IA correcto: se acepta y avanza el protocolo. */
  | { readonly kind: "accepted" }
  /** El solicitante insistió y se acepta para revisión manual del analista. */
  | { readonly kind: "accepted_for_manual_review" }
  /** No corresponde / no se identificó: se pide de nuevo (quedan intentos). */
  | { readonly kind: "mismatch_retry"; readonly attemptsLeft: number }
  /** Se agotaron los intentos: se ofrece enviarlo igual para revisión manual. */
  | { readonly kind: "offer_manual_review" }
  /** Falla estructural dura (formato/tamaño/reuso): se pide reenviar. */
  | { readonly kind: "structural_reject"; readonly reasons: readonly string[] };

/**
 * Decide el destino de un documento entrante.
 *
 * Invariantes:
 * - Si el archivo no pasa el antifraude estructural, se rechaza sin consultar a la IA.
 * - Si la IA no estuvo disponible (`identification === null`), NO se castiga al usuario
 *   por una caída nuestra: se acepta (degradación elegante).
 * - Un documento correcto (coincide y se identificó con claridad) se acepta siempre,
 *   incluso tras superar el límite de intentos (el usuario corrigió a tiempo).
 * - Con `attempt = priorMismatchAttempts + 1`: por debajo del máximo se reintenta; en el
 *   máximo se ofrece revisión manual; por encima se acepta para revisión manual.
 */
export function decideDocumentReview(input: {
  readonly structural: FraudAssessment;
  readonly identification: DocumentIdentification | null;
  readonly priorMismatchAttempts: number;
  readonly maxAttempts: number;
}): DocumentReviewDecision {
  if (!isAcceptable(input.structural)) {
    return { kind: "structural_reject", reasons: input.structural.reasons };
  }

  // La IA no se pudo ejecutar: no bloqueamos la solicitud por indisponibilidad nuestra.
  if (!input.identification) return { kind: "accepted" };

  if (input.identification.matchesExpected && input.identification.clearlyIdentified) {
    return { kind: "accepted" };
  }

  const attempt = input.priorMismatchAttempts + 1;
  if (attempt < input.maxAttempts) {
    return { kind: "mismatch_retry", attemptsLeft: input.maxAttempts - attempt };
  }
  if (attempt === input.maxAttempts) return { kind: "offer_manual_review" };
  return { kind: "accepted_for_manual_review" };
}
