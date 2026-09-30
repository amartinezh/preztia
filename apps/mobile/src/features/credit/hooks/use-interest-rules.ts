import type { PaymentPlanView } from "@preztiaos/contracts";

import { useSession } from "@/core/auth/session";
import { useActivePaymentPlans } from "@/features/payment-plans/api/queries";
import { useOperationalSettings } from "@/features/settings/api/queries";

export interface InterestRules {
  readonly loading: boolean;
  /** "Bloquear cambio de interés": el interés sale de un plan activo. */
  readonly locked: boolean;
  /** ¿Quien otorga puede usar "Personalizado" (interés libre)? */
  readonly customAllowed: boolean;
  readonly activePlans: readonly PaymentPlanView[];
  readonly defaultPlan: PaymentPlanView | null;
}

/**
 * Reglas del interés para las pantallas que otorgan (nuevo crédito y aprobación de solicitudes):
 * con el bloqueo, el interés sale de un plan activo y solo el ADMIN —si la excepción está permitida—
 * ve "Personalizado". Solo decide qué se OFRECE; la regla la impone el servidor
 * (`assertInterestAllowed`, 409 `INTEREST_LOCKED`).
 */
export function useInterestRules(): InterestRules {
  const { role } = useSession();
  const settings = useOperationalSettings();
  const plans = useActivePaymentPlans();
  const locked = settings.data?.blockInterestChange ?? false;
  const adminCustom = settings.data?.adminCustomInterestAllowed ?? true;
  const activePlans = plans.data?.items ?? [];
  return {
    loading: settings.isPending || plans.isPending,
    locked,
    customAllowed: !locked || (adminCustom && role === "ADMIN"),
    activePlans,
    defaultPlan: activePlans.find((p) => p.isDefault) ?? null,
  };
}
