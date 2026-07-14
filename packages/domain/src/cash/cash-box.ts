// Dominio puro de la CAJA (cash box) y su LIBRO MAYOR. Reglas e invariantes del
// movimiento de dinero entre cajas, sin I/O ni framework. El saldo de una caja es la
// suma firmada de sus asientos; nunca un campo almacenado.

import { DomainError } from "../shared/money";

export type CashBoxType = "CASH" | "BANK" | "TRANSIT";
export type CashTxDirection = "IN" | "OUT";
export type CashTxKind =
  | "PAYMENT_IN"
  | "DISBURSEMENT"
  | "WITHDRAWAL"
  | "EXPENSE"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "UNIDENTIFIED";

/** Asiento ya registrado, reducido a lo que importa para el saldo. */
export interface LedgerEntry {
  readonly direction: CashTxDirection;
  readonly amountMinor: number;
}

/** Intención de asiento aún no validada (lo que se quiere postear). */
export interface PostingIntent {
  readonly direction: CashTxDirection;
  readonly kind: CashTxKind;
  readonly amountMinor: number;
  readonly reason: string | null;
}

/**
 * Saldo de la caja: Σ asientos (IN suma, OUT resta). Invariante de integridad:
 * el saldo derivado debe coincidir con `Σ cash_transaction` en persistencia.
 */
export function boxBalanceMinor(entries: readonly LedgerEntry[]): number {
  return entries.reduce(
    (acc, e) => acc + (e.direction === "IN" ? e.amountMinor : -e.amountMinor),
    0,
  );
}

/** ¿Esta naturaleza de movimiento exige siempre un motivo? Los retiros sí. */
function requiresReason(type: CashBoxType, kind: CashTxKind): boolean {
  // Caja Menor (efectivo): TODO movimiento exige detalle/motivo.
  // Retiro: exige motivo en cualquier caja (conciliación frente a la realidad).
  return type === "CASH" || kind === "WITHDRAWAL";
}

/**
 * Verifica que un asiento puede postearse a una caja. Fallo rápido con DomainError
 * ante cualquier violación; el caso de uso asume que, si no lanza, el asiento es válido.
 *
 * Invariantes:
 *  - monto entero positivo (el signo lo da `direction`).
 *  - motivo obligatorio en caja menor y en retiros.
 *  - la caja TRANSIT solo recibe; solo sale de ella reclasificando (TRANSFER).
 *  - una salida (OUT) no puede dejar el saldo negativo (sin sobregiro de caja).
 */
export function assertCanPost(input: {
  readonly type: CashBoxType;
  readonly currentBalanceMinor: number;
  readonly intent: PostingIntent;
}): void {
  const { type, currentBalanceMinor, intent } = input;

  if (!Number.isInteger(intent.amountMinor) || intent.amountMinor <= 0) {
    throw new DomainError("El monto del asiento debe ser un entero positivo en unidades menores");
  }

  if (requiresReason(type, intent.kind) && !hasText(intent.reason)) {
    throw new DomainError("El movimiento exige un motivo/detalle");
  }

  if (intent.direction === "OUT") {
    // Los fondos no identificados solo abandonan la caja TRANSIT al reclasificarse.
    if (type === "TRANSIT" && intent.kind !== "TRANSFER") {
      throw new DomainError("La caja de tránsito solo libera fondos mediante una transferencia");
    }
    if (currentBalanceMinor - intent.amountMinor < 0) {
      throw new DomainError("Saldo insuficiente en la caja para la salida solicitada");
    }
  }
}

/** Intención de transferir entre dos cajas. */
export interface TransferIntent {
  readonly amountMinor: number;
  readonly reason: string | null;
}

/**
 * Construye las DOS patas de una transferencia: una OUT en el origen y una IN en el
 * destino, por el mismo monto. Invariante: la suma de ambas sobre el sistema es 0
 * (no se crea ni destruye dinero al mover entre cajas). Cada pata se valida luego
 * con `assertCanPost` contra su caja (motivo, saldo, reglas de tránsito).
 */
export function buildTransfer(intent: TransferIntent): {
  readonly out: PostingIntent;
  readonly in: PostingIntent;
} {
  if (!Number.isInteger(intent.amountMinor) || intent.amountMinor <= 0) {
    throw new DomainError("El monto de la transferencia debe ser un entero positivo");
  }
  return {
    out: { direction: "OUT", kind: "TRANSFER", amountMinor: intent.amountMinor, reason: intent.reason },
    in: { direction: "IN", kind: "TRANSFER", amountMinor: intent.amountMinor, reason: intent.reason },
  };
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}
