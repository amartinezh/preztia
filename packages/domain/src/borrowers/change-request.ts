// Dominio puro de la SOLICITUD DE MODIFICACIÓN DE CLIENTE ("Solicitud Modificar Cliente" del
// legado): el cobrador propone cambios a los datos de un cliente; el ADMIN/COORDINATOR los
// aprueba (se aplican al cliente) o los rechaza (maker-checker). Sin I/O ni framework.

import { DomainError } from "../shared/money";

export type ChangeRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * Resuelve la revisión de una solicitud de cambio. Solo una solicitud PENDING puede revisarse
 * (transición única; no se reaplican cambios ya resueltos). Devuelve el nuevo estado.
 */
export function decideChangeRequest(
  current: ChangeRequestStatus,
  approve: boolean,
): ChangeRequestStatus {
  if (current !== "PENDING") {
    throw new DomainError("La solicitud de cambio ya fue revisada");
  }
  return approve ? "APPROVED" : "REJECTED";
}
