import { Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { PaymentPlan } from '@preztiaos/domain';
import type {
  NewPaymentPlan,
  PaymentPlanPatch,
  PaymentPlanStore,
} from '@preztiaos/application';
import { NotFoundError } from '@preztiaos/domain';
import { withTenantTxFor, type Tx } from '../../tenancy/unit-of-work';

const plan = schema.paymentPlan;

/**
 * Adaptador del puerto `PaymentPlanStore`: lee/escribe `payment_plan` bajo el rol `app` + RLS.
 * Las operaciones que tocan el invariante "un solo default" (insert/update/setDefault) limpian
 * el default de los demás y escriben el nuevo EN UNA transacción, atómico. El índice parcial
 * único de BD es la red de seguridad ante condiciones de carrera.
 */
@Injectable()
export class PaymentPlanRepository implements PaymentPlanStore {
  async list(input: {
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: PaymentPlan[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const offset = (input.page - 1) * input.pageSize;
      const rows = await tx
        .select()
        .from(plan)
        .where(eq(plan.tenantId, input.tenantId))
        // El default primero, luego activos, luego por nombre: lista estable y legible.
        .orderBy(desc(plan.isDefault), desc(plan.isActive), plan.name)
        .limit(input.pageSize)
        .offset(offset);
      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(plan)
        .where(eq(plan.tenantId, input.tenantId));
      return { items: rows.map(toDomain), total: total ?? 0 };
    });
  }

  async findById(input: {
    tenantId: string;
    id: string;
  }): Promise<PaymentPlan | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(plan)
        .where(and(eq(plan.tenantId, input.tenantId), eq(plan.id, input.id)))
        .limit(1);
      return row ? toDomain(row) : null;
    });
  }

  async listActive(tenantId: string): Promise<PaymentPlan[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(plan)
        .where(and(eq(plan.tenantId, tenantId), eq(plan.isActive, true)))
        // El default primero: encabeza el menú que ve el cliente por WhatsApp.
        .orderBy(desc(plan.isDefault), plan.name);
      return rows.map(toDomain);
    });
  }

  async findDefault(tenantId: string): Promise<PaymentPlan | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(plan)
        .where(and(eq(plan.tenantId, tenantId), eq(plan.isDefault, true)))
        .limit(1);
      return row ? toDomain(row) : null;
    });
  }

  async countDefaults(tenantId: string): Promise<number> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [{ value }] = await tx
        .select({ value: count() })
        .from(plan)
        .where(and(eq(plan.tenantId, tenantId), eq(plan.isDefault, true)));
      return value ?? 0;
    });
  }

  async insert(input: {
    tenantId: string;
    plan: NewPaymentPlan;
    makeDefault: boolean;
  }): Promise<PaymentPlan> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      if (input.makeDefault) await clearDefaults(tx, input.tenantId);
      const [row] = await tx
        .insert(plan)
        .values({
          tenantId: input.tenantId,
          name: input.plan.name,
          installmentsCount: input.plan.installmentsCount,
          frequency: input.plan.frequency,
          interestPct: input.plan.interestPct,
          isActive: input.plan.isActive,
          isDefault: input.makeDefault,
        })
        .returning();
      return toDomain(row);
    });
  }

  async update(input: {
    tenantId: string;
    id: string;
    patch: PaymentPlanPatch;
    makeDefault: boolean;
  }): Promise<PaymentPlan> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      if (input.makeDefault) await clearDefaults(tx, input.tenantId);
      const [row] = await tx
        .update(plan)
        .set({
          ...input.patch,
          ...(input.makeDefault ? { isDefault: true } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(plan.tenantId, input.tenantId), eq(plan.id, input.id)))
        .returning();
      if (!row) throw new NotFoundError('El plan de pago no existe');
      return toDomain(row);
    });
  }

  async setDefault(input: {
    tenantId: string;
    id: string;
  }): Promise<PaymentPlan> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      await clearDefaults(tx, input.tenantId);
      const [row] = await tx
        .update(plan)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(eq(plan.tenantId, input.tenantId), eq(plan.id, input.id)))
        .returning();
      if (!row) throw new NotFoundError('El plan de pago no existe');
      return toDomain(row);
    });
  }

  async delete(input: { tenantId: string; id: string }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .delete(plan)
        .where(and(eq(plan.tenantId, input.tenantId), eq(plan.id, input.id)));
    });
  }
}

/** Quita la marca de default a todos los planes del tenant (paso previo a fijar uno nuevo). */
async function clearDefaults(tx: Tx, tenantId: string): Promise<void> {
  await tx
    .update(plan)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(plan.tenantId, tenantId), eq(plan.isDefault, true)));
}

type PlanRow = typeof schema.paymentPlan.$inferSelect;

/** Traduce la fila de persistencia al tipo de dominio (descarta auditoría createdAt/updatedAt). */
function toDomain(row: PlanRow): PaymentPlan {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    installmentsCount: row.installmentsCount,
    frequency: row.frequency,
    interestPct: row.interestPct,
    isActive: row.isActive,
    isDefault: row.isDefault,
  };
}
