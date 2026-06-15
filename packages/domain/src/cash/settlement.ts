// Dominio puro de la CAJA / LIQUIDACIÓN ("Nueva Liquidada" del legado). El cierre de caja
// encadena el saldo: cada liquidada parte del saldo de la anterior. Sin I/O ni framework.

import { DomainError } from "../shared/money";

export interface SettlementTotals {
  /** Saldo de caja con que abre el período (caja_actual de la liquidada anterior). */
  readonly cajaAnteriorMinor: number;
  /** Total cobrado (abonos aplicados) en el período. */
  readonly totalCobradoMinor: number;
  /** Total prestado (capital desembolsado) en el período. */
  readonly totalPrestadoMinor: number;
  /** Gastos aprobados del período. */
  readonly gastosMinor: number;
}

/**
 * Saldo de caja al cierre:
 *   caja_actual = caja_anterior + cobrado − prestado − gastos
 *
 * Las entradas son montos no negativos en unidades menores enteras (fallo rápido si no). El
 * resultado PUEDE ser negativo (sobregiro real de la operación); no se enmascara.
 */
export function computeCajaActual(totals: SettlementTotals): number {
  // La caja anterior es un saldo ENCADENADO: puede ser negativa (sobregiro de la operación);
  // solo se exige que sea un entero. Los flujos del período sí deben ser no negativos.
  assertInteger(totals.cajaAnteriorMinor, "caja anterior");
  assertNonNegativeInt(totals.totalCobradoMinor, "total cobrado");
  assertNonNegativeInt(totals.totalPrestadoMinor, "total prestado");
  assertNonNegativeInt(totals.gastosMinor, "gastos");
  return (
    totals.cajaAnteriorMinor +
    totals.totalCobradoMinor -
    totals.totalPrestadoMinor -
    totals.gastosMinor
  );
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new DomainError(`El monto de ${label} debe ser un entero`);
  }
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError(`El monto de ${label} debe ser un entero no negativo`);
  }
}
