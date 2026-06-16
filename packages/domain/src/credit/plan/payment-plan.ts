import { ConflictError, DomainError } from "../../shared/money";
import type { ScheduleFrequency } from "../schedule";

// Reglas puras del aggregate `payment_plan`: plantilla de crédito ofertable por tenant
// (nº de cuotas, frecuencia, interés base-mil). Sin I/O ni framework. El esquema de BD y el
// contrato reflejan esta forma (mirror); la persistencia atómica y el aislamiento por RLS los
// resuelve la infraestructura.

/** Cuotas razonables para un plan: al menos una, a lo sumo un año de cobro diario. */
export const MIN_PLAN_INSTALLMENTS = 1;
export const MAX_PLAN_INSTALLMENTS = 365;
/** Interés en base-mil (200 = 20%), igual que `credit.interest_pct` y la comisión del tenant. */
export const MIN_PLAN_INTEREST_BASE_THOUSAND = 0;
export const MAX_PLAN_INTEREST_BASE_THOUSAND = 1000;

/** Forma canónica del plan (espejo de la fila de BD y del contrato). */
export interface PaymentPlan {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly installmentsCount: number;
  readonly frequency: ScheduleFrequency;
  readonly interestPct: number;
  readonly isActive: boolean;
  readonly isDefault: boolean;
}

/** Atributos de un plan que definen su forma de cobro (los que valida el dominio). */
export interface PaymentPlanShape {
  readonly installmentsCount: number;
  readonly interestPct: number;
}

/** Falla rápido si la forma del plan es inválida (entero de cuotas e interés en rango). */
export function assertValidPlanShape(shape: PaymentPlanShape): void {
  if (
    !Number.isInteger(shape.installmentsCount) ||
    shape.installmentsCount < MIN_PLAN_INSTALLMENTS ||
    shape.installmentsCount > MAX_PLAN_INSTALLMENTS
  ) {
    throw new DomainError(
      `El número de cuotas debe ser un entero entre ${MIN_PLAN_INSTALLMENTS} y ${MAX_PLAN_INSTALLMENTS}`,
    );
  }
  if (
    !Number.isInteger(shape.interestPct) ||
    shape.interestPct < MIN_PLAN_INTEREST_BASE_THOUSAND ||
    shape.interestPct > MAX_PLAN_INTEREST_BASE_THOUSAND
  ) {
    throw new DomainError(
      `El interés debe ser un entero (base-mil) entre ${MIN_PLAN_INTEREST_BASE_THOUSAND} y ${MAX_PLAN_INTEREST_BASE_THOUSAND}`,
    );
  }
}

/** Un plan por defecto siempre debe poder ofertarse: no puede quedar inactivo. */
export function assertDefaultIsActive(plan: { isActive: boolean; isDefault: boolean }): void {
  if (plan.isDefault && !plan.isActive) {
    throw new DomainError("El plan por defecto debe estar activo");
  }
}

/**
 * Invariante de tenant: SIEMPRE debe existir al menos un plan por defecto. Bloquea la operación
 * (borrar / desactivar / quitar la marca) cuando el plan afectado es el ÚNICO default vigente.
 * `totalDefaults` es el conteo de planes con `is_default = true` del tenant antes de la operación.
 */
export function assertCanReleaseDefault(
  plan: { isDefault: boolean },
  totalDefaults: number,
): void {
  if (plan.isDefault && totalDefaults <= 1) {
    throw new ConflictError(
      "Debe existir al menos un plan por defecto: marca otro como predeterminado primero",
    );
  }
}

/**
 * Decide si un plan que se crea debe quedar como por defecto: lo es si se pidió explícitamente
 * o si es el primero del tenant (garantiza el invariante ≥ 1 default desde el alta).
 */
export function shouldBecomeDefaultOnCreate(
  requestedDefault: boolean,
  existingDefaults: number,
): boolean {
  return requestedDefault || existingDefaults === 0;
}
