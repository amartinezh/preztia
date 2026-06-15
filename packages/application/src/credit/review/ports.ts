import type { CreditApplicationStatus, ScheduleFrequency } from "@preztiaos/domain";
import type { ScheduledInstallment } from "../grant-credit";

// Puertos de salida de la revisión manual de expedientes (decisión del coordinador).
// La infraestructura los implementa con Drizzle bajo RLS; aquí solo se declaran.

/** Estado mínimo del expediente necesario para decidir la transición. */
export interface ApplicationDecisionSnapshot {
  readonly status: CreditApplicationStatus;
  /** Teléfono del solicitante (E.164 sin '+'): habilita abonos PIX del crédito generado. */
  readonly applicantPhone: string;
}

/** Crédito a otorgar al aprobar el expediente (mismos campos que persiste el slice de crédito). */
export interface GrantedCreditData {
  readonly id: string;
  readonly tenantId: string;
  readonly borrowerId: string;
  readonly zoneId: string;
  readonly principalMinor: number;
  readonly interestPct: number;
  readonly installmentsCount: number;
  readonly frequency: ScheduleFrequency;
  readonly currency: string;
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * Puerto: persiste la decisión manual del coordinador. La aprobación con otorgamiento y el
 * rechazo se escriben de forma ATÓMICA (estado del expediente + evento de auditoría
 * append-only + —al aprobar— el crédito con su cronograma), en una sola transacción.
 */
export interface ApplicationDecisionStore {
  /** Estado actual del expediente; `null` si no existe en el tenant. */
  loadDecisionSnapshot(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<ApplicationDecisionSnapshot | null>;

  /** Marca APPROVED, audita la decisión y genera el crédito, todo en una transacción. */
  approveAndGrant(input: {
    tenantId: string;
    applicationId: string;
    reason: string;
    decidedBy: string;
    credit: GrantedCreditData;
    schedule: readonly ScheduledInstallment[];
    contact?: { phone: string };
  }): Promise<void>;

  /** Marca REJECTED y audita la decisión, en una transacción. */
  reject(input: {
    tenantId: string;
    applicationId: string;
    reason: string;
    decidedBy: string;
  }): Promise<void>;
}
