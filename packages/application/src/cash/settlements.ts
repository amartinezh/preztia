import { randomUUID } from "node:crypto";
import { computeCajaActual } from "@preztiaos/domain";
import type { NewSettlement, SettlementStore } from "./ports";

// Caso de uso: CERRAR una liquidada. Encadena la caja desde la liquidada anterior y cuadra el
// saldo con la regla de dominio. La ventana (periodStart, periodEnd] arranca al cierre anterior,
// así que un re-cierre inmediato produce una liquidada de ventana ~vacía (sin doble conteo).

export interface CloseSettlementCommand {
  tenantId: string;
  closedBy: string;
}

export interface ClosedSettlement {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  cajaAnteriorMinor: number;
  totalCobradoMinor: number;
  totalPrestadoMinor: number;
  gastosMinor: number;
  cajaActualMinor: number;
  cuentasNuevas: number;
  cuentasTerminadas: number;
}

const EPOCH = new Date(0);

export interface SettlementPreviewResult {
  cajaAnteriorMinor: number;
  totalCobradoMinor: number;
  totalPrestadoMinor: number;
  gastosMinor: number;
  cajaActualMinor: number;
  cuentasNuevas: number;
  cuentasTerminadas: number;
  periodStart: Date;
}

/** Vista previa (read-only) de la próxima liquidada: totales desde la última hasta ahora. */
export class PreviewSettlementHandler {
  constructor(private readonly settlements: SettlementStore) {}

  async execute(input: { tenantId: string }): Promise<SettlementPreviewResult> {
    const last = await this.settlements.findLast(input.tenantId);
    const periodStart = last?.periodEnd ?? EPOCH;
    const cajaAnteriorMinor = last?.cajaActualMinor ?? 0;
    const totals = await this.settlements.computeWindowTotals({
      tenantId: input.tenantId,
      periodStart,
      periodEnd: new Date(),
    });
    return {
      cajaAnteriorMinor,
      totalCobradoMinor: totals.totalCobradoMinor,
      totalPrestadoMinor: totals.totalPrestadoMinor,
      gastosMinor: totals.gastosMinor,
      cajaActualMinor: computeCajaActual({
        cajaAnteriorMinor,
        totalCobradoMinor: totals.totalCobradoMinor,
        totalPrestadoMinor: totals.totalPrestadoMinor,
        gastosMinor: totals.gastosMinor,
      }),
      cuentasNuevas: totals.cuentasNuevas,
      cuentasTerminadas: totals.cuentasTerminadas,
      periodStart,
    };
  }
}

export class CloseSettlementHandler {
  constructor(private readonly settlements: SettlementStore) {}

  async execute(cmd: CloseSettlementCommand): Promise<ClosedSettlement> {
    const last = await this.settlements.findLast(cmd.tenantId);
    const periodStart = last?.periodEnd ?? EPOCH;
    const periodEnd = new Date();
    const cajaAnteriorMinor = last?.cajaActualMinor ?? 0;

    const totals = await this.settlements.computeWindowTotals({
      tenantId: cmd.tenantId,
      periodStart,
      periodEnd,
    });
    const cajaActualMinor = computeCajaActual({
      cajaAnteriorMinor,
      totalCobradoMinor: totals.totalCobradoMinor,
      totalPrestadoMinor: totals.totalPrestadoMinor,
      gastosMinor: totals.gastosMinor,
    });

    const settlement: NewSettlement = {
      id: randomUUID(),
      tenantId: cmd.tenantId,
      closedBy: cmd.closedBy,
      periodStart,
      periodEnd,
      cajaAnteriorMinor,
      totalCobradoMinor: totals.totalCobradoMinor,
      totalPrestadoMinor: totals.totalPrestadoMinor,
      gastosMinor: totals.gastosMinor,
      cajaActualMinor,
      cuentasNuevas: totals.cuentasNuevas,
      cuentasTerminadas: totals.cuentasTerminadas,
    };
    await this.settlements.create(settlement);

    return {
      id: settlement.id,
      periodStart,
      periodEnd,
      cajaAnteriorMinor,
      totalCobradoMinor: totals.totalCobradoMinor,
      totalPrestadoMinor: totals.totalPrestadoMinor,
      gastosMinor: totals.gastosMinor,
      cajaActualMinor,
      cuentasNuevas: totals.cuentasNuevas,
      cuentasTerminadas: totals.cuentasTerminadas,
    };
  }
}
