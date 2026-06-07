// Resultado del análisis antifraude de un documento. El "cómo" (OCR, listas,
// verificación de identidad) vive en infraestructura; el dominio solo entiende
// el veredicto y cómo se traduce en una decisión sobre el documento.

/** Veredicto del servicio antifraude sobre un documento. */
export type FraudStatus = "approved" | "suspicious" | "rejected";

/** Evaluación antifraude de un documento entrante. */
export interface FraudAssessment {
  readonly status: FraudStatus;
  /** Puntaje de riesgo en [0,100]; mayor = más riesgo. Informativo/auditable. */
  readonly score: number;
  /** Motivos legibles del veredicto (para el usuario y la auditoría). */
  readonly reasons: readonly string[];
}

/**
 * Solo un documento "approved" se da por válido. "suspicious" y "rejected" exigen
 * reenvío: la integridad del KYC se prefiere sobre avanzar el flujo.
 */
export function isAcceptable(assessment: FraudAssessment): boolean {
  return assessment.status === "approved";
}
