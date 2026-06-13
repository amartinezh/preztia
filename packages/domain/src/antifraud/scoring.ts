// Agregación de alertas antifraude en un veredicto único.
//
// Invariantes (cubiertos por pruebas):
// - Cualquier alerta CRITICA ⇒ status "rejected" (nunca aprobado).
// - Cualquier alerta ALTA ⇒ al menos "suspicious".
// - Sin alertas ⇒ "approved" con score 0.
// - El score queda acotado a [0, 100]; mayor = más riesgo.

import { type FraudStatus } from "../credit/application/fraud";
import { type AlertSeverity, type ValidationAlert } from "./alert";

/** Peso de cada severidad en el score de riesgo (0..100). */
const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  CRITICA: 100,
  ALTA: 40,
  MEDIA: 15,
  BAJA: 5,
};

/** Score a partir del cual el conjunto de anomalías menores se vuelve sospechoso
 *  (dos alertas MEDIA acumuladas ya ameritan revisión humana). */
const SUSPICIOUS_SCORE_THRESHOLD = 30;

const MAX_SCORE = 100;

/** Veredicto agregado de la validación documental. */
export interface ValidationVerdict {
  readonly status: FraudStatus;
  /** Riesgo acumulado en [0,100]; mayor = más riesgo. */
  readonly score: number;
}

/** Combina las alertas de todas las reglas en el veredicto final. */
export function scoreValidation(alerts: readonly ValidationAlert[]): ValidationVerdict {
  const score = Math.min(
    MAX_SCORE,
    alerts.reduce((total, alert) => total + SEVERITY_WEIGHT[alert.severidad], 0),
  );

  if (alerts.some((alert) => alert.severidad === "CRITICA")) {
    return { status: "rejected", score };
  }
  if (
    alerts.some((alert) => alert.severidad === "ALTA") ||
    score >= SUSPICIOUS_SCORE_THRESHOLD
  ) {
    return { status: "suspicious", score };
  }
  return { status: "approved", score };
}
