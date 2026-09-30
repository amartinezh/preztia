import { NotFoundError, assertInterestAllowed, interestPolicyOf, type Role } from "@preztiaos/domain";

import type { PaymentPlanStore } from "./plan/ports";
import type { TenantSettingsStore } from "../tenant/settings";

/** Lo que la guarda del interés necesita leer: la configuración del tenant y el plan elegido. */
export interface InterestGuardPorts {
  readonly settings: TenantSettingsStore;
  readonly plans: PaymentPlanStore;
}

/**
 * Guarda ANTIFRAUDE del interés compartida por toda vía que crea un crédito con términos escritos
 * por una persona (otorgamiento directo y aprobación sin plan negociado). Carga la política del
 * tenant y el plan del que dice salir el crédito; la decisión es del dominio (`assertInterestAllowed`).
 * Un plan inexistente es 404 (nunca se registra un crédito "de un plan" que no existe).
 */
export async function assertCreditInterestAllowed(
  ports: InterestGuardPorts,
  input: { tenantId: string; actorRole: Role; interestPct: number; paymentPlanId: string | null },
): Promise<void> {
  const plan = input.paymentPlanId
    ? await ports.plans.findById({ tenantId: input.tenantId, id: input.paymentPlanId })
    : null;
  if (input.paymentPlanId && !plan) throw new NotFoundError("El plan de pago no existe");
  const settings = await ports.settings.get(input.tenantId);
  assertInterestAllowed({
    policy: interestPolicyOf(settings),
    actorRole: input.actorRole,
    requestedInterestPct: input.interestPct,
    plan,
  });
}
