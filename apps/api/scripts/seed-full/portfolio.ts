import { randomUUID } from 'node:crypto';
import { schema } from '@preztiaos/db';
import {
  allocatePayment,
  businessDateOf,
  assertCanReceiveCredit,
  assertInterestAllowed,
  assertZoneCanUseBox,
  buildSchedule,
  interestPolicyOf,
  Money,
  planMigratedCredit,
  portfolioBalanceMinor,
  remainingMinor,
  resolveInitialCreditLimit,
  scheduleDueDates,
  type AllocationSplit,
  type BorrowerColor,
  type HistoricalPayment,
  type PortfolioInstallment,
  type ScheduleFrequency,
  splitAllocations,
} from '@preztiaos/domain';
import type { TenantContext } from './context';
import {
  address,
  BR_BUSINESSES,
  BR_FIRST_NAMES,
  BR_LAST_NAMES,
  CO_BUSINESSES,
  CO_FIRST_NAMES,
  CO_LAST_NAMES,
  generateCedula,
  generateCpf,
  jitterLocation,
  PIX_PAYER_BANKS,
  testPhone,
} from './fake-data';
import type {
  BorrowerState,
  BoxState,
  CreditState,
  PayerProfile,
  PlanRef,
  Row,
  UserRef,
  ZoneRef,
} from './model';

// CARTERA: clientes, otorgamiento de créditos (directo, por solicitud y migrados) y el escritor
// ÚNICO de abonos. Espejo de `CreditDrizzleRepository`, `ApplicationDecisionRepository`,
// `MigratedCreditRepository` y `allocation-writer` de la API: mismas reglas de dominio (cupo,
// bloqueo del interés, caja usable por la zona, cascada, desglose capital/interés).

export const DIRECT_DISBURSEMENT_REASON =
  'Desembolso de crédito (otorgamiento directo)';
export const APPLICATION_DISBURSEMENT_REASON = 'Desembolso de crédito';

// ── Clientes ────────────────────────────────────────────────────────────────────────────────

export interface NewBorrower {
  readonly zone: ZoneRef;
  readonly collector: UserRef | null;
  readonly profile: PayerProfile;
  readonly at: Date;
  /** Sin coordenadas (cliente sin geolocalizar: no aparece en mapas). */
  readonly withoutLocation?: boolean;
  /** Cupo explícito; ausente = cupo por defecto del tenant. */
  readonly creditLimitMinor?: number;
  readonly color?: BorrowerColor;
  readonly phone?: string;
  readonly fullName?: { first: string; last: string };
}

export function createBorrower(
  ctx: TenantContext,
  input: NewBorrower,
): BorrowerState {
  const { random } = ctx;
  const city = input.zone.city;
  if (!city)
    throw new Error(
      `La zona ${input.zone.path} no tiene ciudad para sus clientes`,
    );
  const brazil = ctx.scenario.countryCode === 'BR';
  const first =
    input.fullName?.first ??
    random.pick(brazil ? BR_FIRST_NAMES : CO_FIRST_NAMES);
  const last =
    input.fullName?.last ??
    `${random.pick(brazil ? BR_LAST_NAMES : CO_LAST_NAMES)} ${random.pick(brazil ? BR_LAST_NAMES : CO_LAST_NAMES)}`;
  const phone = input.phone ?? testPhone(city, ctx.nextPhoneSequence());
  const location = input.withoutLocation ? null : jitterLocation(random, city);
  const row: Row<typeof schema.borrower> = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    nationalId: brazil ? generateCpf(random) : generateCedula(random),
    firstName: first,
    lastName: last,
    business: `${random.pick(brazil ? BR_BUSINESSES : CO_BUSINESSES)} ${first}`,
    address: address(random, city),
    phone,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    color: input.color ?? 'NONE',
    creditBlocked: false,
    creditLimitMinor: resolveInitialCreditLimit(
      input.creditLimitMinor,
      ctx.settings.defaultCreditLimitMinor,
    ),
    createdAt: input.at,
    updatedAt: input.at,
  };
  ctx.batch.track(schema.borrower, row);
  ctx.batch.insert(schema.borrowerContact, {
    tenantId: ctx.tenantId,
    borrowerId: row.id,
    phone,
    channelId: ctx.channelFor(input.zone),
    createdAt: input.at,
  });
  if (input.collector)
    assignCollector(ctx, row.id, input.collector, input.zone, input.at);
  const borrower: BorrowerState = {
    id: row.id,
    zone: input.zone,
    collector: input.collector,
    profile: input.profile,
    phone,
    nationalId: row.nationalId,
    fullName: `${first} ${last}`,
    payerBank: random.pick(PIX_PAYER_BANKS),
    row,
  };
  ctx.borrowers.push(borrower);
  return borrower;
}

/** Asignación cobrador → cliente (la hace el coordinador de la zona). */
export function assignCollector(
  ctx: TenantContext,
  borrowerId: string,
  collector: UserRef,
  zone: ZoneRef,
  at: Date,
): void {
  ctx.batch.insert(schema.collectorClient, {
    tenantId: ctx.tenantId,
    collectorId: collector.id,
    borrowerId,
    assignedBy: ctx.coordinatorFor(zone).id,
    createdAt: at,
  });
}

/** Saldo vigente del cliente en créditos ACTIVOS (base del control de cupo). */
export function outstandingOf(ctx: TenantContext, borrowerId: string): number {
  return ctx.credits
    .filter((c) => c.borrower.id === borrowerId && c.row.status === 'ACTIVE')
    .reduce((acc, c) => acc + portfolioBalanceMinor(c.installments), 0);
}

// ── Otorgamiento ────────────────────────────────────────────────────────────────────────────

export interface GrantInput {
  readonly borrower: BorrowerState;
  readonly principalMinor: number;
  /** Plan del que salen los términos; null = "Personalizado" (solo ADMIN con el bloqueo). */
  readonly plan: PlanRef | null;
  readonly customTerms?: {
    interestPct: number;
    installments: number;
    frequency: ScheduleFrequency;
  };
  readonly fundingBox: BoxState;
  readonly grantedBy: UserRef;
  readonly at: Date;
  readonly reason?: string;
}

export function grantCredit(
  ctx: TenantContext,
  input: GrantInput,
): CreditState {
  const terms = input.plan
    ? {
        interestPct: input.plan.interestPct,
        installments: input.plan.installmentsCount,
        frequency: input.plan.frequency,
      }
    : required(input.customTerms, 'términos personalizados');
  assertInterestAllowed({
    policy: interestPolicyOf(ctx.settings),
    actorRole: input.grantedBy.role,
    requestedInterestPct: terms.interestPct,
    plan: input.plan
      ? { interestPct: input.plan.interestPct, isActive: input.plan.isActive }
      : null,
  });
  assertCanReceiveCredit(
    {
      creditBlocked: input.borrower.row.creditBlocked ?? false,
      creditLimitMinor: input.borrower.row.creditLimitMinor ?? 0,
    },
    {
      requestedMinor: input.principalMinor,
      outstandingMinor: outstandingOf(ctx, input.borrower.id),
    },
  );
  if (input.fundingBox.assignedTo)
    throw new Error('Una caja de ruta no fondea créditos');
  assertZoneCanUseBox(input.borrower.zone.path, input.fundingBox.zonePath);

  const startDate = businessDateFor(ctx, input.at);
  const credit = buildCredit(ctx, {
    borrower: input.borrower,
    principalMinor: input.principalMinor,
    interestPct: terms.interestPct,
    installments: terms.installments,
    frequency: terms.frequency,
    startDate,
    planId: input.plan?.id ?? null,
    at: input.at,
    origin: 'ORIGINATED',
    legacyReference: null,
  });
  ctx.ledger.post({
    box: input.fundingBox,
    direction: 'OUT',
    kind: 'DISBURSEMENT',
    amountMinor: input.principalMinor,
    reason: input.reason ?? DIRECT_DISBURSEMENT_REASON,
    at: input.at,
    createdBy: input.grantedBy.id,
    originZoneId: input.borrower.zone.id,
    refs: { creditId: credit.id },
  });
  ctx.stats.credits += 1;
  return credit;
}

interface BuildCreditInput {
  readonly borrower: BorrowerState;
  readonly principalMinor: number;
  readonly interestPct: number;
  readonly installments: number;
  readonly frequency: ScheduleFrequency;
  readonly startDate: string;
  readonly planId: string | null;
  readonly at: Date;
  readonly origin: 'ORIGINATED' | 'MIGRATED';
  readonly legacyReference: string | null;
}

/** Crédito + cronograma (regla de dominio `buildSchedule` + `scheduleDueDates`). */
function buildCredit(ctx: TenantContext, input: BuildCreditInput): CreditState {
  const schedule = buildSchedule(
    Money.of(input.principalMinor, ctx.currency),
    input.interestPct,
    input.installments,
  );
  const dueDates = scheduleDueDates(
    input.startDate,
    input.frequency,
    input.installments,
  );
  const id = randomUUID();
  const row: Row<typeof schema.credit> = {
    id,
    tenantId: ctx.tenantId,
    borrowerId: input.borrower.id,
    zoneId: input.borrower.zone.id,
    paymentPlanId: input.planId,
    principalMinor: input.principalMinor,
    interestPct: input.interestPct,
    installmentsCount: input.installments,
    frequency: input.frequency,
    currency: ctx.currency,
    startDate: input.startDate,
    endDate: dueDates[dueDates.length - 1]!,
    status: 'ACTIVE',
    origin: input.origin,
    legacyReference: input.legacyReference,
    createdAt: input.at,
  };
  ctx.batch.track(schema.credit, row);
  const installmentRows = new Map<string, Row<typeof schema.installment>>();
  const installments: PortfolioInstallment[] = schedule.map((item, idx) => {
    const installmentRow: Row<typeof schema.installment> = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      creditId: id,
      seq: item.seq,
      dueDate: dueDates[idx]!,
      amountDueMinor: item.amountDueMinor,
      paidMinor: 0,
      status: 'PENDING',
      createdAt: input.at,
      updatedAt: input.at,
    };
    installmentRows.set(installmentRow.id, installmentRow);
    ctx.batch.track(schema.installment, installmentRow);
    return {
      id: installmentRow.id,
      seq: item.seq,
      dueDate: installmentRow.dueDate,
      amountDueMinor: item.amountDueMinor,
      paidMinor: 0,
      status: 'PENDING',
    };
  });
  const credit: CreditState = {
    id,
    borrower: input.borrower,
    zone: input.borrower.zone,
    principalMinor: input.principalMinor,
    totalDueMinor: schedule.reduce((acc, i) => acc + i.amountDueMinor, 0),
    currency: ctx.currency,
    frequency: input.frequency,
    row,
    installments,
    installmentRows,
    paidSoFarMinor: 0,
    stopsPayingOn: null,
  };
  ctx.credits.push(credit);
  return credit;
}

// ── Créditos migrados del sistema anterior (sin libro) ─────────────────────────────────────

export interface MigratedInput {
  readonly borrower: BorrowerState;
  readonly principalMinor: number;
  readonly plan: PlanRef;
  readonly startDate: string;
  readonly legacyReference: string;
  /** Abonos históricos (fechas entre el inicio y el día de la carga). */
  readonly payments: readonly HistoricalPayment[];
  readonly loadedAt: Date;
  readonly loadedBy: UserRef;
}

export function registerMigratedCredit(
  ctx: TenantContext,
  input: MigratedInput,
): CreditState {
  const credit = buildCredit(ctx, {
    borrower: input.borrower,
    principalMinor: input.principalMinor,
    interestPct: input.plan.interestPct,
    installments: input.plan.installmentsCount,
    frequency: input.plan.frequency,
    startDate: input.startDate,
    planId: null,
    at: input.loadedAt,
    origin: 'MIGRATED',
    legacyReference: input.legacyReference,
  });
  const plan = planMigratedCredit({
    startDate: input.startDate,
    today: businessDateFor(ctx, input.loadedAt),
    currency: ctx.currency,
    installments: credit.installments,
    payments: input.payments,
  });
  for (const payment of plan.payments) {
    const paidAt = ctx.clock.at(payment.paidOn, 12);
    const paymentId = randomUUID();
    ctx.batch.track(
      schema.payment,
      paymentRow(ctx, {
        id: paymentId,
        creditId: credit.id,
        amountMinor: payment.amountMinor,
        paidAt,
        createdAt: input.loadedAt,
        status: 'VERIFIED',
        historical: true,
      }),
    );
    applyAllocations(
      ctx,
      credit,
      paymentId,
      payment.amountMinor,
      input.loadedAt,
    );
    ctx.batch.insert(schema.paymentEvent, {
      tenantId: ctx.tenantId,
      paymentId,
      creditId: credit.id,
      type: 'historical_payment_migrated',
      payload: {
        amountMinor: payment.amountMinor,
        paidAt: paidAt.toISOString(),
      },
      createdAt: input.loadedAt,
    });
  }
  if (plan.settled) credit.row.status = 'SETTLED';
  ctx.audit({
    at: input.loadedAt,
    actorId: input.loadedBy.id,
    action: 'MIGRATE credit',
    entity: 'credit',
    entityId: credit.id,
    payload: {
      legacyReference: input.legacyReference,
      startDate: input.startDate,
      principalMinor: input.principalMinor,
      historicalPayments: plan.payments.length,
      historicalPaidMinor: plan.paidMinor,
    },
  });
  ctx.stats.credits += 1;
  return credit;
}

// ── Abonos (escritor único, espejo de `allocation-writer`) ──────────────────────────────────

export interface AppliedPayment {
  readonly splits: readonly AllocationSplit[];
  readonly overpaymentMinor: number;
  readonly settled: boolean;
}

/**
 * Reparte un abono en cascada (`allocatePayment`), lo desglosa en capital/interés sobre lo
 * acumulado (`splitAllocations`) y persiste las asignaciones y el nuevo estado de las cuotas.
 */
export function applyAllocations(
  ctx: TenantContext,
  credit: CreditState,
  paymentId: string,
  amountMinor: number,
  at: Date,
): AppliedPayment {
  const result = allocatePayment(
    credit.currency,
    credit.installments,
    Money.of(amountMinor, credit.currency),
  );
  const splits = splitAllocations(
    {
      principalMinor: credit.principalMinor,
      totalDueMinor: credit.totalDueMinor,
    },
    credit.paidSoFarMinor,
    result.allocations,
  );
  credit.installments = [...result.installments];
  for (const split of splits) {
    const updated = credit.installments.find(
      (i) => i.id === split.installmentId,
    )!;
    const row = credit.installmentRows.get(split.installmentId)!;
    row.paidMinor = updated.paidMinor;
    row.status = updated.status;
    row.updatedAt = at;
    ctx.batch.track(schema.installment, row);
    ctx.batch.insert(schema.paymentAllocation, {
      tenantId: ctx.tenantId,
      paymentId,
      installmentId: split.installmentId,
      amountMinor: split.amountMinor,
      principalMinor: split.principalMinor,
      interestMinor: split.interestMinor,
      createdAt: at,
    });
    credit.paidSoFarMinor += split.amountMinor;
  }
  // Regla del dominio (`creditSettled`): una cartera saldada deja el crédito SETTLED, en toda vía
  // de abono (espejo de `settleCreditTx` de la API; un castigado que se recupera también).
  if (
    result.creditSettled &&
    (credit.row.status === 'ACTIVE' || credit.row.status === 'DEFAULTED')
  )
    credit.row.status = 'SETTLED';
  return {
    splits,
    overpaymentMinor: result.overpaymentMinor,
    settled: result.creditSettled,
  };
}

/** Fila de pago con todas sus columnas (los pagos cambian de estado: se rastrean por id). */
export function paymentRow(
  ctx: TenantContext,
  input: {
    id: string;
    creditId: string | null;
    amountMinor: number | null;
    paidAt: Date | null;
    createdAt: Date;
    status:
      | 'RECEIVED'
      | 'VERIFIED'
      | 'UNVERIFIED'
      | 'REJECTED_FRAUD'
      | 'REJECTED_INVALID';
    historical?: boolean;
    payerPhone?: string;
    idempotencyKey?: string | null;
  },
): Row<typeof schema.payment> {
  return {
    id: input.id,
    tenantId: ctx.tenantId,
    creditId: input.creditId,
    providerMessageId: null,
    channelId: null,
    payerPhone: input.payerPhone ?? '',
    amountMinor: input.amountMinor,
    currency: ctx.currency,
    paidAt: input.paidAt,
    payerName: null,
    payerTaxId: null,
    payerBankName: null,
    receiverPixKey: null,
    endToEndId: null,
    txid: null,
    extractionRaw: null,
    sha256: null,
    storageKey: null,
    mimeType: null,
    status: input.status,
    bankStatus: null,
    bankResponse: null,
    verifiedAt: input.status === 'VERIFIED' ? input.createdAt : null,
    reconciliationAttempts: 0,
    lastReconciliationAt: null,
    idempotencyKey: input.idempotencyKey ?? null,
    historical: input.historical ?? false,
    createdAt: input.createdAt,
  };
}

// ── Consultas sobre el estado en memoria ────────────────────────────────────────────────────

/** Saldo de las cuotas vencidas o que vencen hasta `date` (lo exigible ese día). */
export function dueUpTo(credit: CreditState, date: string): number {
  return credit.installments
    .filter((i) => i.dueDate <= date)
    .reduce((acc, i) => acc + remainingMinor(i), 0);
}

/** Cuotas vencidas (antes de `date`) con saldo: la mora que ven visitas, rutas y mapas. */
export function overdueCount(credit: CreditState, date: string): number {
  return credit.installments.filter(
    (i) => i.dueDate < date && remainingMinor(i) > 0,
  ).length;
}

/** Valor de la siguiente cuota con saldo (para abonos "de una cuota"). */
export function nextInstallmentMinor(credit: CreditState): number {
  const next = credit.installments.find((i) => remainingMinor(i) > 0);
  return next ? remainingMinor(next) : 0;
}

export function balanceOf(credit: CreditState): number {
  return portfolioBalanceMinor(credit.installments);
}

export function isPaidOff(credit: CreditState): boolean {
  return balanceOf(credit) === 0;
}

/** Día de negocio de un instante en la zona horaria de la empresa. */
export function businessDateFor(ctx: TenantContext, at: Date): string {
  return businessDateOf(at, ctx.clock.timeZone);
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Seed: falta ${label}`);
  return value;
}
