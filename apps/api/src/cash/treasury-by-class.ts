import type { CashBoxType } from '@preztiaos/domain';

// Regla PURA de la TESORERÍA (fuente única para Inicio, Dinero y Operación): cómo se reparte el
// dinero de la empresa en el lenguaje del dueño ("en la oficina", "en la calle", "en el banco").
// Sin I/O: recibe los saldos ya agregados por caja y los clasifica; `treasury-snapshot.ts` aporta
// las filas desde el libro.

/** Saldo de una caja activa con lo necesario para clasificarla. */
export interface CashBoxBalance {
  readonly type: CashBoxType;
  /** Cobrador dueño de la caja (caja de ruta) o null si es de oficina. */
  readonly assignedTo: string | null;
  readonly balanceMinor: number;
}

/** Clase de caja según quién tiene el dinero: oficina, calle (cobrador), banco o en tránsito. */
export type CashBoxClass = 'OFFICE' | 'ROUTE' | 'BANK' | 'TRANSIT';

export interface TreasuryByClass {
  /** Σ de todas las cajas activas (el "efectivo disponible" histórico del panel). */
  readonly totalMinor: number;
  /** Efectivo en cajas de oficina: CASH sin cobrador asignado. */
  readonly officeMinor: number;
  /** Efectivo en la calle: cajas de ruta (CASH con cobrador asignado). */
  readonly routeMinor: number;
  /** Dinero en cuentas bancarias (BANK). */
  readonly bankMinor: number;
  /** Dinero sin identificar aún (TRANSIT); solo cuenta en el total. */
  readonly transitMinor: number;
  /** Liquidez disponible: lo que la empresa puede usar hoy = oficina + bancos. */
  readonly availableMinor: number;
}

/**
 * Una caja CASH es de ruta cuando tiene cobrador; la BD garantiza (CHECK) que BANK y TRANSIT
 * nunca tienen cobrador, por eso la clase sale del tipo y del dueño sin ambigüedad.
 */
export function cashBoxClass(
  box: Pick<CashBoxBalance, 'type' | 'assignedTo'>,
): CashBoxClass {
  if (box.type === 'BANK') return 'BANK';
  if (box.type === 'TRANSIT') return 'TRANSIT';
  return box.assignedTo === null ? 'OFFICE' : 'ROUTE';
}

/**
 * Invariantes: `totalMinor === officeMinor + routeMinor + bankMinor + transitMinor` y
 * `availableMinor === officeMinor + bankMinor` (el efectivo en ruta aún no está entregado y el
 * tránsito no está identificado: no se puede contar con ellos hoy).
 */
export function sumTreasuryByClass(
  boxes: readonly CashBoxBalance[],
): TreasuryByClass {
  const totals: Record<CashBoxClass, number> = {
    OFFICE: 0,
    ROUTE: 0,
    BANK: 0,
    TRANSIT: 0,
  };
  for (const box of boxes) totals[cashBoxClass(box)] += box.balanceMinor;
  return {
    totalMinor: totals.OFFICE + totals.ROUTE + totals.BANK + totals.TRANSIT,
    officeMinor: totals.OFFICE,
    routeMinor: totals.ROUTE,
    bankMinor: totals.BANK,
    transitMinor: totals.TRANSIT,
    availableMinor: totals.OFFICE + totals.BANK,
  };
}
