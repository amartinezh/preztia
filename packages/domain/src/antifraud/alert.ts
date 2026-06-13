// Alerta antifraude producida por las reglas de validación documental.
// Es el vocabulario común de todo el pipeline (Etapas 2 y 3 del análisis
// documental): cada regla devuelve cero o más alertas y la decisión final
// se calcula agregándolas (ver scoring.ts).

/** Severidad de una alerta antifraude, de mayor a menor gravedad. */
export type AlertSeverity = "CRITICA" | "ALTA" | "MEDIA" | "BAJA";

/** Hallazgo de una regla antifraude sobre un campo del documento. */
export interface ValidationAlert {
  /** Campo o aspecto del documento donde se detectó la anomalía. */
  readonly campo: string;
  readonly severidad: AlertSeverity;
  /** Explicación legible para el analista y la auditoría. */
  readonly detalle: string;
}

/** Construye una alerta (azúcar para que las reglas se lean como narración). */
export function alerta(
  campo: string,
  severidad: AlertSeverity,
  detalle: string,
): ValidationAlert {
  return { campo, severidad, detalle };
}
