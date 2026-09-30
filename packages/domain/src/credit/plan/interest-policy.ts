import { ConflictError } from "../../shared/money";
import type { Role } from "../../iam/role";

// Regla ANTIFRAUDE del interés de un crédito, pura y sin I/O.
//
// Con el bloqueo encendido ("Bloquear cambio de interés"), el interés de un crédito SOLO puede salir
// de un plan de pago ACTIVO, que únicamente crea y edita el ADMIN. Así un coordinador no puede
// inventar condiciones: ni con "Personalizado" ni alterando el interés de un plan elegido (ese
// crédito quedaría registrado "del plan" con otro interés, que es el engaño más difícil de ver). El
// tenant decide si el ADMIN conserva la vía "Personalizado" como excepción.
//
// Invariante (probada): con el bloqueo encendido, todo crédito aceptado tiene
//   interés = interés de un plan activo,  o  lo otorgó un ADMIN con la excepción permitida.

/** Configuración del tenant (Ajustes → General). */
export interface InterestPolicy {
  /** "Bloquear cambio de interés": el interés sale de un plan activo. */
  readonly locked: boolean;
  /** Con el bloqueo encendido, ¿el ADMIN puede otorgar con un interés personalizado? */
  readonly adminCustomAllowed: boolean;
}

/** Plan del que dice salir el crédito (lo que la regla necesita saber de él). */
export interface InterestSourcePlan {
  readonly interestPct: number;
  readonly isActive: boolean;
}

/** Interés en base mil como porcentaje legible ("20 %"). */
function asPercent(baseThousand: number): string {
  return `${baseThousand / 10} %`;
}

/**
 * Falla rápido (409 `INTEREST_LOCKED`, `PLAN_INACTIVE`) si el interés pedido viola el bloqueo. Nunca
 * corrige en silencio: si el interés no coincide con el del plan, se rechaza y se dice cuál es.
 */
export function assertInterestAllowed(input: {
  readonly policy: InterestPolicy;
  readonly actorRole: Role;
  readonly requestedInterestPct: number;
  /** null = "Personalizado" (sin plan). */
  readonly plan: InterestSourcePlan | null;
}): void {
  const { policy, plan } = input;
  if (!policy.locked) return;
  if (plan) {
    if (!plan.isActive) {
      throw new ConflictError("El plan elegido no está activo", "PLAN_INACTIVE");
    }
    if (input.requestedInterestPct !== plan.interestPct) {
      throw new ConflictError(
        `El interés está bloqueado: debe ser el del plan (${asPercent(plan.interestPct)})`,
        "INTEREST_LOCKED",
      );
    }
    return;
  }
  if (!canUseCustomInterest(policy, input.actorRole)) {
    throw new ConflictError(
      policy.adminCustomAllowed
        ? "El interés está bloqueado: elige un plan de pago (solo el administrador puede personalizarlo)"
        : "El interés está bloqueado: elige un plan de pago activo",
      "INTEREST_LOCKED",
    );
  }
}

/** ¿Este rol puede otorgar con interés personalizado ("Personalizado", sin plan)? */
export function canUseCustomInterest(policy: InterestPolicy, actorRole: Role): boolean {
  return !policy.locked || (policy.adminCustomAllowed && actorRole === "ADMIN");
}
