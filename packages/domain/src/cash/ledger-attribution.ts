// Reglas PURAS de atribución del libro de cajas por ZONA y por COBRADOR.
//
// Dos preguntas distintas: ¿dónde está la plata? (la caja) y ¿quién generó el flujo? (la zona
// del hecho de negocio). Como las zonas hijas usan cajas de sus ancestros, la caja no sirve
// para atribuir: cada asiento SELLA su zona al postearse, según el origen del movimiento.
// Sellar al escribir hace que la foto de una liquidación no cambie si el crédito se reasigna.

import { ConflictError } from "../shared/money";
import { isWithinScope } from "../iam/zone-path";

/**
 * ¿Una zona puede mover dinero de esta caja? Sí si la caja es del tenant (sin zona) o si
 * pertenece a la misma zona o a un ancestro (la zona hija trabaja con las cuentas del padre).
 */
export function canZoneUseBox(zonePath: string, boxZonePath: string | null): boolean {
  return boxZonePath === null || isWithinScope(zonePath, [boxZonePath]);
}

/** Fallo rápido (409) si la zona no puede usar la caja. */
export function assertZoneCanUseBox(zonePath: string, boxZonePath: string | null): void {
  if (!canZoneUseBox(zonePath, boxZonePath)) {
    throw new ConflictError(
      "La caja no pertenece a la zona ni a una zona superior",
      "BOX_NOT_USABLE_BY_ZONE",
    );
  }
}

/** Atributos de la caja que intervienen en la atribución. */
export interface AttributableBox {
  readonly zoneId: string | null;
  /** Cobrador dueño de la caja de ruta; null en cajas de oficina, bancarias y tránsito. */
  readonly assignedTo: string | null;
}

export interface LedgerAttribution {
  readonly zoneId: string | null;
  readonly collectorId: string | null;
}

/**
 * Zona y cobrador que se sellan en un asiento:
 * - zona: la del hecho de negocio (crédito, gasto) si existe; si no, la de la caja.
 * - cobrador: el dueño de la caja de ruta; todo lo que entra o sale de ella es suyo.
 */
export function ledgerAttribution(input: {
  originZoneId: string | null;
  box: AttributableBox;
}): LedgerAttribution {
  return {
    zoneId: input.originZoneId ?? input.box.zoneId,
    collectorId: input.box.assignedTo,
  };
}
