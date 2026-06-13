// Coherencia ENTRE los documentos de una misma solicitud (Etapa 2/3):
// la identidad, el registro del negocio y el comprobante de residencia deben
// contar la misma historia. Un titular de recibo sin relación con el
// solicitante, o un solicitante que no figura en el QSA del negocio, es alerta.

import { alerta, type ValidationAlert } from "./alert";
import { nameMatchesAny, namesLooselyMatch } from "./normalize-name";

export interface DocumentCoherenceInput {
  /** Nombre del titular según el documento de identidad. */
  readonly identidadNombre: string | null;
  /** Titular impreso en el recibo de servicio público. */
  readonly titularRecibo: string | null;
  /** Cuadro societario del negocio (del registro oficial si está disponible). */
  readonly sociosNegocio: readonly string[];
}

/** Verifica que los tres documentos pertenezcan a la misma historia. */
export function crossCheckDocumentCoherence(
  input: DocumentCoherenceInput,
): ValidationAlert[] {
  const alerts: ValidationAlert[] = [];

  if (
    input.identidadNombre &&
    input.sociosNegocio.length > 0 &&
    !nameMatchesAny(input.identidadNombre, input.sociosNegocio)
  ) {
    alerts.push(
      alerta(
        "qsa",
        "ALTA",
        `el solicitante ("${input.identidadNombre}") no figura en el cuadro societario del negocio: sin poderes aparentes`,
      ),
    );
  }

  if (input.titularRecibo) {
    const matchesIdentity =
      input.identidadNombre !== null &&
      namesLooselyMatch(input.titularRecibo, input.identidadNombre);
    const matchesPartner = nameMatchesAny(input.titularRecibo, input.sociosNegocio);
    if (!matchesIdentity && !matchesPartner) {
      alerts.push(
        alerta(
          "titular",
          "MEDIA",
          `el titular del recibo ("${input.titularRecibo}") no coincide con el solicitante ni con los socios del negocio`,
        ),
      );
    }
  }

  return alerts;
}
