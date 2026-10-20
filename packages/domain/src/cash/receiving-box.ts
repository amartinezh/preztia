// Regla PURA de la CAJA QUE RECIBE un abono registrado a mano (sin I/O).
//
// El cobrador recibe en SU caja de ruta: es su efectivo y entra en su rendición. Quien no tiene
// caja de ruta (ADMIN, COORDINATOR) registra lo que el cliente pagó en la oficina o consignó en una
// cuenta: elige una caja de oficina o bancaria que la zona del crédito puede usar. Nunca la caja de
// ruta de un cobrador (le descuadraría la rendición, igual que un gasto o una comisión pagados
// desde ella) ni Tránsito (es solo para el dinero que no se pudo identificar).
//
// Invariantes (probadas):
// - un cobrador nunca elige caja: recibe en la suya;
// - quien no es cobrador siempre dice dónde entró el dinero (no hay caja por defecto);
// - la caja elegida está activa, no es de ruta ni de tránsito y su zona la puede usar.

import { ConflictError, DomainError, ForbiddenError } from "../shared/money";
import type { Role } from "../iam/role";
import type { CashBoxType } from "./cash-box";
import { assertZoneCanUseBox } from "./ledger-attribution";

/** Dónde entra el dinero del abono. */
export type ReceivingBox =
  | { readonly kind: "ROUTE_BOX" }
  | { readonly kind: "CHOSEN_BOX"; readonly cashBoxId: string };

/** Decide de dónde sale la caja que recibe según quién registra el abono. */
export function resolveReceivingBox(input: {
  readonly actorRole: Role;
  readonly requestedCashBoxId: string | null;
}): ReceivingBox {
  if (input.actorRole === "COLLECTOR") {
    if (input.requestedCashBoxId) {
      throw new ForbiddenError(
        "El cobrador recibe el efectivo en su caja de ruta",
        "RECEIVING_BOX_NOT_ALLOWED",
      );
    }
    return { kind: "ROUTE_BOX" };
  }
  if (!input.requestedCashBoxId) {
    throw new DomainError(
      "Elige la caja o la cuenta que recibe el dinero",
      "RECEIVING_BOX_REQUIRED",
    );
  }
  return { kind: "CHOSEN_BOX", cashBoxId: input.requestedCashBoxId };
}

/** Caja candidata a recibir un abono elegida por quien no es cobrador. */
export interface CandidateReceivingBox {
  readonly type: CashBoxType;
  /** Cobrador dueño si es caja de ruta. */
  readonly assignedTo: string | null;
  readonly active: boolean;
  readonly zonePath: string | null;
}

/** Fallo rápido (409) si la caja elegida no puede recibir el abono del crédito. */
export function assertCanReceivePaymentInto(input: {
  readonly creditZonePath: string;
  readonly box: CandidateReceivingBox;
}): void {
  const { box } = input;
  if (!box.active) {
    throw new ConflictError("La caja que recibe el dinero está inactiva", "RECEIVING_BOX_INACTIVE");
  }
  if (box.assignedTo !== null || box.type === "TRANSIT") {
    throw new ConflictError(
      "El pago se recibe en una caja de oficina o en una cuenta bancaria",
      "INVALID_RECEIVING_BOX",
    );
  }
  assertZoneCanUseBox(input.creditZonePath, box.zonePath);
}
