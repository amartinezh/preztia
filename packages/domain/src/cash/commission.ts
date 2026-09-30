// Dominio puro de la COMISIÓN DEL COBRADOR, sin I/O.
//
// La comisión es un porcentaje (base mil: 50 = 5 %) sobre UNA base del trabajo del cobrador en el
// período, elegida por configuración:
// - COLLECTED: lo cobrado en efectivo en ruta (lo que entró a su caja de ruta).
// - REMITTED: lo rendido = lo que salió de su caja de ruta por entregas y consignaciones, neto de
//   lo que se le entregó (base de caja), nunca negativo.
// - PRINCIPAL_RECOVERED: el capital recuperado de esos mismos cobros en efectivo (sin el interés).
//
// La política se define POR ZONA y se hereda: una zona sin configuración toma la de su ancestro
// más cercano que la tenga y, si ninguno, el valor por defecto del tenant. El ADMIN fija un TOPE
// que manda sobre todas: ninguna zona se puede configurar por encima y, si el tope baja después,
// la tasa efectiva se recorta al tope.
//
// Las comisiones se ENCIENDEN o APAGAN para todo el tenant (`enabled`, lo decide el ADMIN). Apagadas,
// no se causa ninguna al cerrar; la configuración por zona se conserva para cuando se enciendan.
//
// Invariantes (probadas):
// - 0 ≤ tasa efectiva ≤ tope ≤ 1000.
// - comisión = ⌊ base × tasa / 1000 ⌋, así que 0 ≤ comisión ≤ base (enteros, sin coma flotante).
// - lo rendido nunca es negativo.

import { ConflictError, DomainError } from "../shared/money";
import { isWithinScope } from "../iam/zone-path";
import { assertCanPayOnBehalfOf, type PayingBox } from "./ledger-attribution";

export const COMMISSION_BASES = ["COLLECTED", "REMITTED", "PRINCIPAL_RECOVERED"] as const;
export type CommissionBase = (typeof COMMISSION_BASES)[number];

/** 1000 = 100 %: el máximo de la escala base mil (igual que el interés). */
export const COMMISSION_RATE_SCALE = 1000;

/** Porcentaje y base de la comisión (lo que se configura en una zona o en el tenant). */
export interface CommissionPolicy {
  /** Porcentaje en base mil (50 = 5 %). */
  readonly ratePerMille: number;
  readonly base: CommissionBase;
}

/** Configuración propia de una zona (las que no tienen, heredan). */
export interface ZoneCommissionSetting {
  readonly zoneId: string;
  readonly path: string;
  readonly policy: CommissionPolicy;
}

/** Configuración de comisiones del tenant: valor por defecto, tope y lo definido por zona. */
export interface CommissionConfig {
  /** ¿El tenant paga comisiones? Apagadas, la liquidación no causa ninguna. */
  readonly enabled: boolean;
  readonly tenantDefault: CommissionPolicy;
  /** Tope que fija el ADMIN (base mil). Con 0, nadie cobra comisión hasta que lo suba. */
  readonly capPerMille: number;
  readonly zoneSettings: readonly ZoneCommissionSetting[];
}

/** Política que realmente aplica a un cobrador, con su origen (para mostrar y sellar). */
export interface EffectiveCommissionPolicy extends CommissionPolicy {
  /** Zona de la que se heredó; null = valor por defecto del tenant. */
  readonly sourceZoneId: string | null;
  /** La tasa configurada superaba el tope y se recortó. */
  readonly cappedByLimit: boolean;
}

/** Cifras del cobrador en el período sobre las que se puede calcular la comisión. */
export interface CommissionFigures {
  readonly collectedMinor: number;
  readonly remittedMinor: number;
  readonly principalRecoveredMinor: number;
}

/** Comisión causada en un período (queda sellada en la fotografía de la liquidación). */
export interface CollectorCommission {
  readonly base: CommissionBase;
  readonly ratePerMille: number;
  readonly sourceZoneId: string | null;
  readonly cappedByLimit: boolean;
  /** Monto de la base elegida en el período. */
  readonly baseAmountMinor: number;
  /** Comisión causada = ⌊ base × tasa / 1000 ⌋. */
  readonly amountMinor: number;
}

function isValidRate(ratePerMille: number): boolean {
  return Number.isInteger(ratePerMille) && ratePerMille >= 0 && ratePerMille <= COMMISSION_RATE_SCALE;
}

/** El tope del ADMIN: entero en [0, 1000]. */
export function assertValidCommissionCap(capPerMille: number): void {
  if (!isValidRate(capPerMille)) {
    throw new DomainError("El tope de comisión debe ser un porcentaje entre 0 y 100");
  }
}

/**
 * Una política configurable: tasa entera en [0, 1000], base conocida y sin superar el tope
 * (409 `COMMISSION_ABOVE_CAP`: el coordinador no puede pasar por encima de lo que fijó el ADMIN).
 */
export function assertValidCommissionPolicy(policy: CommissionPolicy, capPerMille: number): void {
  if (!isValidRate(policy.ratePerMille)) {
    throw new DomainError("La comisión debe ser un porcentaje entre 0 y 100");
  }
  if (!COMMISSION_BASES.includes(policy.base)) {
    throw new DomainError("Base de comisión desconocida");
  }
  if (policy.ratePerMille > capPerMille) {
    throw new ConflictError("La comisión supera el tope fijado por el administrador", "COMMISSION_ABOVE_CAP");
  }
}

/**
 * Política efectiva de un cobrador según la zona de su caja de ruta: la configuración de la zona
 * más profunda que contiene a la suya (ella misma o un ancestro); si ninguna, la del tenant. Un
 * cobrador sin zona usa la del tenant. La tasa se recorta al tope vigente.
 */
export function resolveCommissionPolicy(zonePath: string | null, config: CommissionConfig): EffectiveCommissionPolicy {
  const owner =
    zonePath === null
      ? undefined
      : config.zoneSettings
          .filter((s) => isWithinScope(zonePath, [s.path]))
          .reduce<ZoneCommissionSetting | undefined>(
            (deepest, s) => (deepest === undefined || depthOf(s.path) > depthOf(deepest.path) ? s : deepest),
            undefined,
          );
  const policy = owner?.policy ?? config.tenantDefault;
  const cap = Math.max(0, config.capPerMille);
  return {
    base: policy.base,
    ratePerMille: Math.min(policy.ratePerMille, cap),
    sourceZoneId: owner?.zoneId ?? null,
    cappedByLimit: policy.ratePerMille > cap,
  };
}

function depthOf(path: string): number {
  return path.split(".").length;
}

/** Lo rendido: salidas de su caja de ruta menos lo que se le entregó; nunca negativo. */
export function remittedAmount(transfersOutMinor: number, transfersInMinor: number): number {
  return Math.max(0, transfersOutMinor - transfersInMinor);
}

/** Monto de la base elegida. */
export function commissionBaseAmount(base: CommissionBase, figures: CommissionFigures): number {
  switch (base) {
    case "COLLECTED":
      return figures.collectedMinor;
    case "REMITTED":
      return figures.remittedMinor;
    case "PRINCIPAL_RECOVERED":
      return figures.principalRecoveredMinor;
  }
}

/** Comisión causada: ⌊ base × tasa / 1000 ⌋ (redondeo a favor de la empresa, en enteros). */
export function computeCommission(policy: EffectiveCommissionPolicy, figures: CommissionFigures): CollectorCommission {
  const baseAmountMinor = Math.max(0, commissionBaseAmount(policy.base, figures));
  return {
    base: policy.base,
    ratePerMille: policy.ratePerMille,
    sourceZoneId: policy.sourceZoneId,
    cappedByLimit: policy.cappedByLimit,
    baseAmountMinor,
    amountMinor: Math.floor((baseAmountMinor * policy.ratePerMille) / COMMISSION_RATE_SCALE),
  };
}

/**
 * ¿De qué caja se paga la comisión? Igual que un gasto del cobrador: de SU caja de ruta (se la queda
 * del efectivo que tiene y baja su deuda) o de una caja de oficina o banco que su zona puede usar.
 */
export function assertCanPayCommissionFrom(input: {
  collectorId: string;
  collectorZonePath: string | null;
  box: PayingBox;
}): void {
  assertCanPayOnBehalfOf(
    { beneficiaryId: input.collectorId, zonePath: input.collectorZonePath, box: input.box },
    {
      foreignRouteBoxMessage: "No se puede pagar una comisión desde la caja de ruta de otro cobrador",
      foreignRouteBoxCode: "COMMISSION_BOX_NOT_ALLOWED",
      noZoneMessage: "Un cobrador sin zona cobra su comisión de una caja general del tenant",
    },
  );
}

/** Solo se paga una comisión causada mayor que cero (409 `NOTHING_TO_PAY`). */
export function assertCommissionPayable(amountMinor: number): void {
  if (amountMinor <= 0) {
    throw new ConflictError("No hay comisión causada que pagar", "NOTHING_TO_PAY");
  }
}
