import type { PaymentPlan, ScheduleFrequency } from "@preztiaos/domain";

// Puerto de salida del slice de Planes de Pago. La infraestructura lo implementa con Drizzle
// bajo el rol `app` + RLS. Las operaciones que tocan el invariante "un solo default" son
// ATÓMICAS en el adaptador (limpiar otros defaults + escribir el nuevo en una transacción).

/** Datos de un plan a crear (sin id; lo genera la persistencia). */
export interface NewPaymentPlan {
  readonly name: string;
  readonly installmentsCount: number;
  readonly frequency: ScheduleFrequency;
  readonly interestPct: number;
  readonly isActive: boolean;
  readonly isDefault: boolean;
}

/** Campos editables de un plan (todos opcionales: parche). */
export interface PaymentPlanPatch {
  readonly name?: string;
  readonly installmentsCount?: number;
  readonly frequency?: ScheduleFrequency;
  readonly interestPct?: number;
  readonly isActive?: boolean;
  readonly isDefault?: boolean;
}

export interface PaymentPlanStore {
  list(input: {
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: PaymentPlan[]; total: number }>;

  findById(input: { tenantId: string; id: string }): Promise<PaymentPlan | null>;

  /** Planes activos del tenant (los ofertables al cliente por WhatsApp). */
  listActive(tenantId: string): Promise<PaymentPlan[]>;

  /** Plan por defecto del tenant; `null` si aún no hay ninguno. */
  findDefault(tenantId: string): Promise<PaymentPlan | null>;

  /** Cantidad de planes con `is_default = true` del tenant (para el invariante ≥ 1). */
  countDefaults(tenantId: string): Promise<number>;

  /** Inserta un plan; si `makeDefault`, quita el default a los demás EN LA MISMA transacción. */
  insert(input: {
    tenantId: string;
    plan: NewPaymentPlan;
    makeDefault: boolean;
  }): Promise<PaymentPlan>;

  /** Aplica el parche; si `makeDefault`, quita el default a los demás en la misma transacción. */
  update(input: {
    tenantId: string;
    id: string;
    patch: PaymentPlanPatch;
    makeDefault: boolean;
  }): Promise<PaymentPlan>;

  /** Marca este plan como único default (limpia los otros) en una transacción. */
  setDefault(input: { tenantId: string; id: string }): Promise<PaymentPlan>;

  delete(input: { tenantId: string; id: string }): Promise<void>;
}
