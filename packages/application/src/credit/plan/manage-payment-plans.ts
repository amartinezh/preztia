import {
  NotFoundError,
  assertCanReleaseDefault,
  assertDefaultIsActive,
  assertValidPlanShape,
  shouldBecomeDefaultOnCreate,
  type PaymentPlan,
} from "@preztiaos/domain";

import type { NewPaymentPlan, PaymentPlanPatch, PaymentPlanStore } from "./ports";

// Casos de uso del aggregate `payment_plan`. Orquestan dominio (invariantes puros) + puerto y
// definen la transacción; no validan HTTP ni arman SQL. El invariante "exactamente un default
// por tenant" se garantiza con: índice parcial único en BD (≤ 1) + estas reglas (≥ 1).

/** Crea un plan. El primer plan del tenant queda por defecto aunque no se pida (≥ 1 default). */
export class CreatePaymentPlanHandler {
  constructor(private readonly store: PaymentPlanStore) {}

  async execute(cmd: {
    tenantId: string;
    plan: NewPaymentPlan;
  }): Promise<PaymentPlan> {
    assertValidPlanShape(cmd.plan);
    const existingDefaults = await this.store.countDefaults(cmd.tenantId);
    const makeDefault = shouldBecomeDefaultOnCreate(cmd.plan.isDefault, existingDefaults);
    // Un plan por defecto siempre debe poder ofertarse: si va a ser default, queda activo.
    const isActive = makeDefault ? true : cmd.plan.isActive;
    assertDefaultIsActive({ isActive, isDefault: makeDefault });
    return this.store.insert({
      tenantId: cmd.tenantId,
      plan: { ...cmd.plan, isActive, isDefault: makeDefault },
      makeDefault,
    });
  }
}

/** Edita un plan (incluye activar/desactivar). Protege el invariante del default. */
export class UpdatePaymentPlanHandler {
  constructor(private readonly store: PaymentPlanStore) {}

  async execute(cmd: {
    tenantId: string;
    id: string;
    patch: PaymentPlanPatch;
  }): Promise<PaymentPlan> {
    const current = await this.store.findById({ tenantId: cmd.tenantId, id: cmd.id });
    if (!current) throw new NotFoundError("El plan de pago no existe");

    const next = { ...current, ...cmd.patch };
    assertValidPlanShape(next);
    assertDefaultIsActive(next);

    // Liberar la marca de default (quitarla o desactivar el default) exige que exista otro default.
    const releasesDefault = current.isDefault && (next.isDefault === false || next.isActive === false);
    if (releasesDefault) {
      const totalDefaults = await this.store.countDefaults(cmd.tenantId);
      assertCanReleaseDefault({ isDefault: current.isDefault }, totalDefaults);
    }

    const makeDefault = next.isDefault === true && current.isDefault === false;
    return this.store.update({
      tenantId: cmd.tenantId,
      id: cmd.id,
      patch: cmd.patch,
      makeDefault,
    });
  }
}

/** Marca un plan como el único default del tenant. El plan debe existir y estar activo. */
export class SetDefaultPaymentPlanHandler {
  constructor(private readonly store: PaymentPlanStore) {}

  async execute(cmd: { tenantId: string; id: string }): Promise<PaymentPlan> {
    const current = await this.store.findById({ tenantId: cmd.tenantId, id: cmd.id });
    if (!current) throw new NotFoundError("El plan de pago no existe");
    assertDefaultIsActive({ isActive: current.isActive, isDefault: true });
    return this.store.setDefault({ tenantId: cmd.tenantId, id: cmd.id });
  }
}

/** Elimina un plan. No se permite borrar el único default (rompería el invariante ≥ 1). */
export class DeletePaymentPlanHandler {
  constructor(private readonly store: PaymentPlanStore) {}

  async execute(cmd: { tenantId: string; id: string }): Promise<void> {
    const current = await this.store.findById({ tenantId: cmd.tenantId, id: cmd.id });
    if (!current) throw new NotFoundError("El plan de pago no existe");
    if (current.isDefault) {
      const totalDefaults = await this.store.countDefaults(cmd.tenantId);
      assertCanReleaseDefault({ isDefault: current.isDefault }, totalDefaults);
    }
    await this.store.delete({ tenantId: cmd.tenantId, id: cmd.id });
  }
}
