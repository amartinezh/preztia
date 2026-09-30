import { randomUUID } from "node:crypto";
import {
  Money,
  buildSchedule,
  businessDateOf,
  localHourInstant,
  planMigratedCredit,
  scheduleDueDates,
  type HistoricalPayment,
  type PaymentAllocation,
  type PortfolioInstallment,
  type ScheduleFrequency,
} from "@preztiaos/domain";

// Caso de uso: CARGAR UN CRÉDITO MIGRADO del sistema anterior (solo ADMIN; lo filtra el controlador).
// Es deuda que ya existe: no sale dinero de ninguna caja ni entran hoy sus abonos históricos, así
// que no toca el libro de cajas. No aplican el cupo ni el bloqueo del interés (condiciones heredadas
// del sistema anterior); todo queda auditado y marcado como migrado.

/** Hora local con la que se fecha un abono histórico (mediodía de su día). */
const HISTORICAL_PAYMENT_HOUR = 12;

export interface RegisterMigratedCreditCommand {
  readonly tenantId: string;
  readonly borrowerId: string;
  readonly zoneId: string;
  readonly principalMinor: number;
  readonly interestPct: number;
  readonly installmentsCount: number;
  readonly frequency: ScheduleFrequency;
  readonly currency: string;
  /** Día en que empezó el crédito en el sistema anterior (YYYY-MM-DD). */
  readonly startDate: string;
  /** Identificador en el sistema anterior: evita cargar dos veces el mismo crédito. */
  readonly legacyReference: string | null;
  readonly payments: readonly HistoricalPayment[];
  /** ADMIN que carga el crédito (queda en la auditoría). */
  readonly migratedBy: string;
}

export interface MigratedPayment {
  readonly paidAt: Date;
  readonly amountMinor: number;
  readonly allocations: readonly PaymentAllocation[];
}

export interface MigratedCreditStore {
  /** Zona horaria del tenant (define "hoy" y la hora de los abonos históricos). */
  timeZone(tenantId: string): Promise<string>;
  /**
   * Persiste en UNA transacción el crédito (origen MIGRATED), sus cuotas, los abonos históricos con
   * su reparto y la auditoría. Sin asientos en el libro de cajas. Una referencia repetida es 409
   * `LEGACY_REFERENCE_TAKEN`; un cliente inexistente, 404.
   */
  save(input: {
    tenantId: string;
    credit: {
      id: string;
      borrowerId: string;
      zoneId: string;
      principalMinor: number;
      interestPct: number;
      installmentsCount: number;
      frequency: ScheduleFrequency;
      currency: string;
      startDate: string;
      endDate: string;
      settled: boolean;
      legacyReference: string | null;
    };
    installments: readonly PortfolioInstallment[];
    payments: readonly MigratedPayment[];
    migratedBy: string;
  }): Promise<void>;
}

export interface RegisterMigratedCreditResult {
  readonly id: string;
  readonly installments: number;
  readonly paidMinor: number;
  readonly balanceMinor: number;
  readonly settled: boolean;
}

export class RegisterMigratedCreditHandler {
  constructor(
    private readonly store: MigratedCreditStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(cmd: RegisterMigratedCreditCommand): Promise<RegisterMigratedCreditResult> {
    const timeZone = await this.store.timeZone(cmd.tenantId);
    const now = this.clock();
    const schedule = buildSchedule(
      Money.of(cmd.principalMinor, cmd.currency),
      cmd.interestPct,
      cmd.installmentsCount,
    );
    const dueDates = scheduleDueDates(cmd.startDate, cmd.frequency, cmd.installmentsCount);
    // Ids generados aquí: el reparto de los abonos históricos se calcula en el dominio, antes de persistir.
    const installments: PortfolioInstallment[] = schedule.map((item, idx) => ({
      id: randomUUID(),
      seq: item.seq,
      dueDate: dueDates[idx]!,
      amountDueMinor: item.amountDueMinor,
      paidMinor: 0,
      status: "PENDING",
    }));

    const plan = planMigratedCredit({
      startDate: cmd.startDate,
      today: businessDateOf(now, timeZone),
      currency: cmd.currency,
      installments,
      payments: cmd.payments,
    });

    const id = randomUUID();
    await this.store.save({
      tenantId: cmd.tenantId,
      credit: {
        id,
        borrowerId: cmd.borrowerId,
        zoneId: cmd.zoneId,
        principalMinor: cmd.principalMinor,
        interestPct: cmd.interestPct,
        installmentsCount: cmd.installmentsCount,
        frequency: cmd.frequency,
        currency: cmd.currency,
        startDate: cmd.startDate,
        endDate: dueDates[dueDates.length - 1]!,
        settled: plan.settled,
        legacyReference: cmd.legacyReference,
      },
      installments,
      payments: plan.payments.map((p) => ({
        paidAt: historicalInstant(p.paidOn, timeZone, now),
        amountMinor: p.amountMinor,
        allocations: p.allocations,
      })),
      migratedBy: cmd.migratedBy,
    });

    const totalDue = installments.reduce((acc, i) => acc + i.amountDueMinor, 0);
    return {
      id,
      installments: installments.length,
      paidMinor: plan.paidMinor,
      balanceMinor: totalDue - plan.paidMinor,
      settled: plan.settled,
    };
  }
}

/** Mediodía local del día del abono (sin pasar de "ahora" si el abono es de hoy). */
function historicalInstant(paidOn: string, timeZone: string, now: Date): Date {
  const noon = localHourInstant(paidOn, HISTORICAL_PAYMENT_HOUR, timeZone);
  return noon > now ? now : noon;
}
