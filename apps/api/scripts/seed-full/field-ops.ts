import { randomUUID } from 'node:crypto';
import { schema } from '@preztiaos/db';
import {
  assertCanIssueDeposit,
  assertCanReceivePaymentInto,
  assertCanPayExpenseFrom,
  assertCanSubmitRemittance,
  assessReception,
  backdatePolicyOf,
  buildDebtClosure,
  businessDateOf,
  carriedDebtMinor,
  formatMoneyMinor,
  remittanceObligation,
  reportDeposit,
  resolvePaymentDate,
  resolveReceivingBox,
  resolveStop,
  reviewExpense,
  summarizeRemittance,
  verifyDeposit,
  type DebtClosureType,
  type RequestedPaymentDate,
  type StopOutcome,
} from '@preztiaos/domain';
import type { TenantContext } from './context';
import type { DayTimeline } from './clock';
import { ACCENTS, PNG_MIME, receiptPng } from './files';
import type { Ledger, LedgerMovement } from './ledger';
import type { BoxState, CreditState, Row, UserRef, ZoneRef } from './model';
import { applyAllocations, balanceOf, paymentRow } from './portfolio';

// OPERACIÓN DE CAMPO: cobro en efectivo, gastos, rendición de cuentas, consignaciones, cierre de
// deuda, órdenes de ruta y visitas. Espejo de `registerCashPaymentTx`, `ExpenseDrizzleRepository`,
// `RemittanceDrizzleRepository`, `DepositOrderDrizzleRepository` y `CollectionRouteDrizzleRepository`.

const CASH_COLLECTION_REASON = 'Cobro en efectivo en ruta';
const OFFICE_PAYMENT_REASON = 'Abono registrado en oficina';
const DELIVERY_REASON = 'Entrega de rendición del cobrador';
const DEPOSIT_REASON = 'Consignación del cobrador a la cuenta';
const REMITTANCE_ENTITY = 'collector-remittance';
const ORDER_ENTITY = 'field-order';
const ROUTE_ENTITY = 'collection-route';

// ── Cobro en efectivo ───────────────────────────────────────────────────────────────────────

export interface CashPaymentInput {
  readonly credit: CreditState;
  readonly amountMinor: number;
  /** Quien registra (en la API, la sesión): el cobrador recibe en su caja de ruta. */
  readonly receivedBy: UserRef;
  readonly at: Date;
  /** Clave Idempotency-Key (abono desde la app); null = liquidación de una parada de ruta. */
  readonly idempotencyKey?: string | null;
  /** Fecha pedida (captura offline o elegida a mano por el ADMIN). */
  readonly requestedDate?: RequestedPaymentDate;
  /** Caja de oficina o cuenta que recibe el dinero cuando registra quien no es cobrador. */
  readonly receivingBox?: BoxState;
}

/**
 * Abono en efectivo: pago VERIFIED + PAYMENT_IN (a la caja de ruta del cobrador o a la caja de
 * oficina elegida) + cascada + crédito SETTLED si queda saldado + bitácora.
 */
export function registerCashPayment(
  ctx: TenantContext,
  input: CashPaymentInput,
): string {
  const actor = input.receivedBy;
  const box = receivingBoxFor(ctx, input);
  const date = resolvePaymentDate(input.requestedDate ?? null, {
    policy: backdatePolicyOf(ctx.settings),
    actorRole: actor.role,
    now: input.at,
    timeZone: ctx.clock.timeZone,
    sealedUntil: ctx.sealedUntil,
  });
  const paymentId = randomUUID();
  ctx.batch.track(
    schema.payment,
    paymentRow(ctx, {
      id: paymentId,
      creditId: input.credit.id,
      amountMinor: input.amountMinor,
      paidAt: date.paidAt,
      createdAt: input.at,
      status: 'VERIFIED',
      idempotencyKey: input.idempotencyKey ?? null,
    }),
  );
  ctx.ledger.post({
    box,
    direction: 'IN',
    kind: 'PAYMENT_IN',
    amountMinor: input.amountMinor,
    reason: input.receivingBox ? OFFICE_PAYMENT_REASON : CASH_COLLECTION_REASON,
    at: input.at,
    createdBy: actor.id,
    originZoneId: input.credit.zone.id,
    refs: { paymentId },
  });
  const applied = applyAllocations(
    ctx,
    input.credit,
    paymentId,
    input.amountMinor,
    input.at,
  );
  ctx.batch.insert(schema.paymentEvent, {
    tenantId: ctx.tenantId,
    paymentId,
    creditId: input.credit.id,
    type: 'cash_payment_registered',
    payload: {
      amountMinor: input.amountMinor,
      allocations: applied.splits.length,
      settled: applied.settled,
      paidAt: date.paidAt.toISOString(),
      ...(input.requestedDate ? { dateSource: input.requestedDate.kind } : {}),
      ...(input.receivingBox
        ? { receivingCashBoxId: input.receivingBox.id }
        : {}),
    },
    createdAt: input.at,
  });
  if (applied.settled) {
    ctx.batch.insert(schema.paymentEvent, {
      tenantId: ctx.tenantId,
      paymentId,
      creditId: input.credit.id,
      type: 'credit_settled',
      payload: { creditId: input.credit.id },
      createdAt: input.at,
    });
  }
  if (input.requestedDate && (date.backdated || date.adjusted)) {
    ctx.audit({
      at: input.at,
      actorId: actor.id,
      action: date.adjusted ? 'ADJUST payment-date' : 'BACKDATE payment',
      entity: 'payment',
      entityId: paymentId,
      payload: {
        source: input.requestedDate.kind,
        requested:
          input.requestedDate.kind === 'OFFLINE_CAPTURE'
            ? input.requestedDate.capturedAt.toISOString()
            : input.requestedDate.paidOn,
        paidAt: date.paidAt.toISOString(),
        registeredAt: input.at.toISOString(),
        adjusted: date.adjusted,
        amountMinor: input.amountMinor,
      },
    });
  }
  if (input.idempotencyKey) {
    ctx.batch.insert(schema.idempotencyKey, {
      tenantId: ctx.tenantId,
      key: input.idempotencyKey,
      method: 'POST',
      path: `/credits/${input.credit.id}/payments`,
      status: 201,
      response: {
        id: paymentId,
        creditId: input.credit.id,
        amountMinor: input.amountMinor,
        balanceMinor: balanceOf(input.credit),
      },
      createdAt: input.at,
    });
  }
  ctx.stats.payments += 1;
  return paymentId;
}

/** Caja que recibe: la de ruta del cobrador o la elegida por la oficina (reglas del dominio). */
function receivingBoxFor(
  ctx: TenantContext,
  input: CashPaymentInput,
): BoxState {
  const receiving = resolveReceivingBox({
    actorRole: input.receivedBy.role,
    requestedCashBoxId: input.receivingBox?.id ?? null,
  });
  if (receiving.kind === 'ROUTE_BOX')
    return ctx.routeBoxOf(input.receivedBy.id);
  const box = input.receivingBox!;
  assertCanReceivePaymentInto({
    creditZonePath: input.credit.zone.path,
    box: {
      type: box.type,
      assignedTo: box.assignedTo,
      active: box.row.active ?? true,
      zonePath: box.zonePath,
    },
  });
  return box;
}

// ── Gastos (maker-checker) ──────────────────────────────────────────────────────────────────

export interface ExpenseRecord {
  readonly row: Row<typeof schema.expense>;
}

export async function requestExpense(
  ctx: TenantContext,
  input: {
    requestedBy: UserRef;
    zone: ZoneRef | null;
    description: string;
    amountMinor: number;
    at: Date;
  },
): Promise<ExpenseRecord> {
  const id = randomUUID();
  const file = await ctx.files.put(
    `expenses/${ctx.tenantId}/${id}`,
    receiptPng(
      'RECIBO DE GASTO',
      [
        input.description,
        `VALOR: ${formatMoneyMinor(input.amountMinor, ctx.currency)}`,
        `FECHA: ${businessDateOf(input.at, ctx.clock.timeZone)}`,
        `SOLICITA: ${input.requestedBy.email}`,
      ],
      ACCENTS.expense!,
    ),
    PNG_MIME,
  );
  const row: Row<typeof schema.expense> = {
    id,
    tenantId: ctx.tenantId,
    requestedBy: input.requestedBy.id,
    description: input.description,
    amountMinor: input.amountMinor,
    status: 'PENDING',
    reviewedBy: null,
    reviewedAt: null,
    zoneId: input.zone?.id ?? null,
    rejectionReason: null,
    paidFromCashBoxId: null,
    receiptStorageKey: file.storageKey,
    receiptMimeType: PNG_MIME,
    receiptSha256: file.sha256,
    createdAt: input.at,
  };
  ctx.batch.track(schema.expense, row);
  ctx.audit({
    at: input.at,
    actorId: input.requestedBy.id,
    action: 'POST /expenses',
    entity: 'expenses',
    entityId: id,
    payload: { description: input.description, amountMinor: input.amountMinor },
  });
  ctx.stats.expenses += 1;
  return { row };
}

/** Aprobación (paga desde la caja indicada) o rechazo con motivo. */
export function reviewExpenseRequest(
  ctx: TenantContext,
  input: {
    expense: ExpenseRecord;
    reviewer: UserRef;
    at: Date;
    approveFrom?: BoxState;
    rejectionReason?: string;
  },
): void {
  const { row } = input.expense;
  const decision = reviewExpense({
    current: row.status ?? 'PENDING',
    approve: Boolean(input.approveFrom),
    rejectionReason: input.rejectionReason,
  });
  row.status = decision.status;
  row.reviewedBy = input.reviewer.id;
  row.reviewedAt = input.at;
  row.rejectionReason = decision.rejectionReason;
  if (input.approveFrom) {
    const zonePath =
      [...ctx.zones.values()].find((z) => z.id === row.zoneId)?.path ?? null;
    assertCanPayExpenseFrom({
      requestedBy: row.requestedBy,
      expenseZonePath: zonePath,
      box: {
        assignedTo: input.approveFrom.assignedTo,
        zonePath: input.approveFrom.zonePath,
      },
    });
    row.paidFromCashBoxId = input.approveFrom.id;
    ctx.ledger.post({
      box: input.approveFrom,
      direction: 'OUT',
      kind: 'EXPENSE',
      amountMinor: row.amountMinor,
      reason: row.description,
      at: input.at,
      createdBy: input.reviewer.id,
      originZoneId: row.zoneId ?? null,
      originCollectorId: row.requestedBy,
      refs: { expenseId: row.id },
    });
  }
  ctx.audit({
    at: input.at,
    actorId: input.reviewer.id,
    action: 'PATCH /expenses/:id',
    entity: 'expenses',
    entityId: row.id,
    payload: {
      status: decision.status,
      rejectionReason: decision.rejectionReason,
    },
  });
}

// ── Rendición de cuentas del cobrador ───────────────────────────────────────────────────────

/**
 * Estado de rendición de una caja de ruta: los movimientos posteriores al último corte salen de la
 * historia del libro (mismo orden que `created_at`), como en `loadRouteBoxState` de la API.
 */
export class RouteBook {
  private cutIndex = 0;
  private closingAtCut = 0;
  open: Row<typeof schema.collectorRemittance> | null = null;

  constructor(
    private readonly ledger: Ledger,
    readonly box: BoxState,
    readonly collector: UserRef,
  ) {}

  private get sinceCut(): LedgerMovement[] {
    return (this.ledger.history.get(this.box.id) ?? []).slice(this.cutIndex);
  }

  get summary() {
    return summarizeRemittance(this.closingAtCut, this.sinceCut);
  }

  get hasUnremittedCollections(): boolean {
    return this.sinceCut.some(isCollection);
  }

  get oldestCollectionAt(): Date | null {
    return this.sinceCut.find(isCollection)?.at ?? null;
  }

  get carriedDebt(): number {
    return carriedDebtMinor(this.closingAtCut, this.summary.debtClosedMinor);
  }

  /** Sella el corte: lo registrado hasta aquí quedó en el saldo recibido. */
  cut(): void {
    this.cutIndex = (this.ledger.history.get(this.box.id) ?? []).length;
    this.closingAtCut = this.box.balance;
  }
}

function isCollection(m: LedgerMovement): boolean {
  return m.direction === 'IN' && m.kind === 'PAYMENT_IN';
}

/** El cobrador declara lo que entrega (SUBMITTED). */
export function submitRemittance(
  ctx: TenantContext,
  input: {
    book: RouteBook;
    declaredMinor: number;
    note: string | null;
    at: Date;
  },
): Row<typeof schema.collectorRemittance> {
  const { book } = input;
  assertCanSubmitRemittance({
    hasOpenSubmission: book.open !== null,
    hasUnremittedCollections: book.hasUnremittedCollections,
    balanceMinor: book.box.balance,
    declaredMinor: input.declaredMinor,
  });
  const summary = book.summary;
  if (summary.expectedMinor !== book.box.balance) {
    throw new Error(
      `Rendición inconsistente en ${book.box.name}: ${summary.expectedMinor} ≠ ${book.box.balance}`,
    );
  }
  const obligation = remittanceObligation({
    hasOpenSubmission: false,
    oldestUnremittedCollectionAt: book.oldestCollectionAt,
    now: input.at,
    deadlineHourLocal: ctx.settings.remittanceDeadlineHourLocal,
    timeZone: ctx.clock.timeZone,
  });
  const row: Row<typeof schema.collectorRemittance> = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    collectorId: book.collector.id,
    cashBoxId: book.box.id,
    zoneId: book.box.zoneId,
    status: 'SUBMITTED',
    businessDate: businessDateOf(input.at, ctx.clock.timeZone),
    dueAt: obligation.dueAt,
    summary,
    declaredMinor: input.declaredMinor,
    collectorNote: input.note,
    submittedAt: input.at,
    receivedBy: null,
    receivedAt: null,
    destinationCashBoxId: null,
    expectedAtReceptionMinor: null,
    countedMinor: null,
    shortfallMinor: null,
    closingBalanceMinor: null,
    cutAt: null,
    receiverNote: null,
    transferGroupId: null,
  };
  ctx.batch.track(schema.collectorRemittance, row);
  book.open = row;
  ctx.audit({
    at: input.at,
    actorId: book.collector.id,
    action: 'SUBMIT collector-remittance',
    entity: REMITTANCE_ENTITY,
    entityId: row.id,
    payload: {
      declaredMinor: input.declaredMinor,
      expectedMinor: summary.expectedMinor,
      lateMinutes: obligation.lateMinutes,
    },
  });
  ctx.stats.remittances += 1;
  return row;
}

/** El coordinador cuenta y recibe: TRANSFER ruta → oficina por lo contado; el faltante es deuda. */
export function receiveRemittance(
  ctx: TenantContext,
  input: {
    book: RouteBook;
    receiver: UserRef;
    countedMinor: number;
    destination: BoxState;
    note: string | null;
    timeline: DayTimeline;
    hour: number;
    minute: number;
  },
): void {
  const { book } = input;
  const open = book.open;
  if (!open) throw new Error('No hay rendición abierta que recibir');
  const at = input.timeline.at(input.hour, input.minute);
  const expectedMinor = book.box.balance;
  const { shortfallMinor } = assessReception({
    expectedMinor,
    countedMinor: input.countedMinor,
  });
  let transferGroupId: string | null = null;
  if (input.countedMinor > 0) {
    transferGroupId = ctx.ledger.transfer({
      from: book.box,
      to: input.destination,
      amountMinor: input.countedMinor,
      reason: DELIVERY_REASON,
      at,
      createdBy: input.receiver.id,
    });
  }
  const cutAt = input.timeline.justAfter();
  Object.assign(open, {
    status: 'RECEIVED',
    receivedBy: input.receiver.id,
    receivedAt: cutAt,
    destinationCashBoxId: input.destination.id,
    expectedAtReceptionMinor: expectedMinor,
    countedMinor: input.countedMinor,
    shortfallMinor,
    closingBalanceMinor: book.box.balance,
    cutAt,
    receiverNote: input.note,
    transferGroupId,
  });
  book.cut();
  book.open = null;
  ctx.audit({
    at: cutAt,
    actorId: input.receiver.id,
    action: 'RECEIVE collector-remittance',
    entity: REMITTANCE_ENTITY,
    entityId: open.id,
    payload: {
      expectedMinor,
      countedMinor: input.countedMinor,
      shortfallMinor,
    },
  });
}

/** Cierre de deuda del cobrador (solo ADMIN): DEBT_CLOSURE en su caja de ruta. */
export function closeCollectorDebt(
  ctx: TenantContext,
  input: {
    book: RouteBook;
    type: DebtClosureType;
    amountMinor: number;
    reason: string;
    at: Date;
  },
): void {
  const intent = buildDebtClosure({
    debtMinor: input.book.carriedDebt,
    amountMinor: input.amountMinor,
    type: input.type,
    reason: input.reason,
    remittanceInProgress: input.book.open !== null,
  });
  ctx.ledger.post({
    box: input.book.box,
    direction: intent.direction,
    kind: intent.kind,
    amountMinor: intent.amountMinor,
    reason: intent.reason,
    at: input.at,
    createdBy: ctx.admin.id,
    debtClosureType: input.type,
  });
  ctx.audit({
    at: input.at,
    actorId: ctx.admin.id,
    action: 'CLOSE collector-debt',
    entity: REMITTANCE_ENTITY,
    entityId: input.book.collector.id,
    payload: { type: input.type, amountMinor: input.amountMinor },
  });
}

// ── Orden de consignación (ruta → cuenta bancaria) ──────────────────────────────────────────

export type DepositStage =
  | 'ISSUED'
  | 'SEEN'
  | 'REPORTED'
  | 'DISPUTED'
  | 'VERIFIED'
  | 'CANCELLED';

export interface DepositOrder {
  readonly row: Row<typeof schema.fieldOrder>;
  readonly destination: BoxState;
}

export function issueDeposit(
  ctx: TenantContext,
  input: {
    book: RouteBook;
    destination: BoxState;
    amountMinor: number;
    issuedBy: UserRef;
    instructions: string;
    at: Date;
  },
): DepositOrder {
  assertCanIssueDeposit({
    amountMinor: input.amountMinor,
    cashInHandMinor: input.book.box.balance,
  });
  if (input.destination.type !== 'BANK')
    throw new Error('La consignación va a una cuenta bancaria');
  const row: Row<typeof schema.fieldOrder> = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    kind: 'DEPOSIT',
    status: 'ISSUED',
    collectorId: input.book.collector.id,
    routeCashBoxId: input.book.box.id,
    zoneId: input.book.box.zoneId,
    destinationCashBoxId: input.destination.id,
    amountMinor: input.amountMinor,
    instructions: input.instructions,
    issuedBy: input.issuedBy.id,
    issuedAt: input.at,
    reportedAmountMinor: null,
    depositedAt: null,
    depositReference: null,
    receiptStorageKey: null,
    receiptMimeType: null,
    receiptSha256: null,
    reportedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    verifiedAmountMinor: null,
    transferGroupId: null,
    updatedAt: input.at,
  };
  ctx.batch.track(schema.fieldOrder, row);
  orderEvent(ctx, row, 'ISSUED', input.issuedBy, input.at, input.instructions, {
    amountMinor: input.amountMinor,
  });
  ctx.stats.depositOrders += 1;
  return { row, destination: input.destination };
}

export function seeDeposit(
  ctx: TenantContext,
  order: DepositOrder,
  at: Date,
): void {
  order.row.status = 'SEEN';
  order.row.updatedAt = at;
  orderEvent(
    ctx,
    order.row,
    'SEEN',
    userById(ctx, order.row.collectorId),
    at,
    null,
    null,
  );
}

export async function reportDepositOrder(
  ctx: TenantContext,
  input: {
    order: DepositOrder;
    amountMinor: number;
    depositedAt: Date;
    reference: string;
    note: string | null;
    at: Date;
  },
): Promise<void> {
  const { row } = input.order;
  const next = reportDeposit(row.status ?? 'ISSUED', {
    amountMinor: input.amountMinor,
    depositedAt: input.depositedAt,
    now: input.at,
  });
  const key = `deposits/${ctx.tenantId}/${row.id}/${randomUUID()}`;
  const file = await ctx.files.put(
    key,
    receiptPng(
      'COMPROVANTE DEPOSITO',
      [
        `VALOR: ${formatMoneyMinor(input.amountMinor, ctx.currency)}`,
        `REF: ${input.reference}`,
        `DATA: ${input.depositedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      ],
      ACCENTS.deposit!,
    ),
    PNG_MIME,
  );
  Object.assign(row, {
    status: next,
    reportedAmountMinor: input.amountMinor,
    depositedAt: input.depositedAt,
    depositReference: input.reference,
    receiptStorageKey: file.storageKey,
    receiptMimeType: PNG_MIME,
    receiptSha256: file.sha256,
    reportedAt: input.at,
    updatedAt: input.at,
  });
  orderEvent(
    ctx,
    row,
    'REPORTED',
    userById(ctx, row.collectorId),
    input.at,
    input.note,
    {
      amountMinor: input.amountMinor,
      depositedAt: input.depositedAt.toISOString(),
      reference: input.reference,
      receiptStorageKey: file.storageKey,
    },
  );
}

/** El coordinador verifica: TRANSFER ruta → banco y consume el ingreso bancario enlazado. */
export function verifyDepositOrder(
  ctx: TenantContext,
  input: {
    order: DepositOrder;
    book: RouteBook;
    verifier: UserRef;
    amountMinor: number;
    bankCredit: Row<typeof schema.incomingCredit> | null;
    note: string | null;
    at: Date;
  },
): void {
  const { row } = input.order;
  const next = verifyDeposit(row.status ?? 'REPORTED', {
    verifiedAmountMinor: input.amountMinor,
  });
  if (input.bankCredit) input.bankCredit.consumedByFieldOrderId = row.id;
  const transferGroupId = ctx.ledger.transfer({
    from: input.book.box,
    to: input.order.destination,
    amountMinor: input.amountMinor,
    reason: DEPOSIT_REASON,
    at: input.at,
    createdBy: input.verifier.id,
  });
  Object.assign(row, {
    status: next,
    verifiedBy: input.verifier.id,
    verifiedAt: input.at,
    verifiedAmountMinor: input.amountMinor,
    transferGroupId,
    updatedAt: input.at,
  });
  orderEvent(ctx, row, 'VERIFIED', input.verifier, input.at, input.note, {
    verifiedAmountMinor: input.amountMinor,
    bankCreditId: input.bankCredit?.id ?? null,
  });
  ctx.audit({
    at: input.at,
    actorId: input.verifier.id,
    action: 'VERIFY deposit-order',
    entity: ORDER_ENTITY,
    entityId: row.id,
    payload: { verifiedAmountMinor: input.amountMinor, transferGroupId },
  });
}

/** Objeción (REPORTED → DISPUTED) o cancelación, siempre con motivo. */
export function closeDepositOrder(
  ctx: TenantContext,
  input: {
    order: DepositOrder;
    actor: UserRef;
    action: 'DISPUTED' | 'CANCELLED';
    reason: string;
    at: Date;
  },
): void {
  input.order.row.status = input.action;
  input.order.row.updatedAt = input.at;
  orderEvent(
    ctx,
    input.order.row,
    input.action,
    input.actor,
    input.at,
    input.reason,
    null,
  );
}

export function commentDeposit(
  ctx: TenantContext,
  order: DepositOrder,
  actor: UserRef,
  message: string,
  at: Date,
): void {
  orderEvent(ctx, order.row, 'COMMENT', actor, at, message, null);
}

function orderEvent(
  ctx: TenantContext,
  row: Row<typeof schema.fieldOrder>,
  type:
    | 'ISSUED'
    | 'SEEN'
    | 'REPORTED'
    | 'DISPUTED'
    | 'VERIFIED'
    | 'CANCELLED'
    | 'COMMENT',
  actor: UserRef,
  at: Date,
  message: string | null,
  payload: Record<string, unknown> | null,
): void {
  ctx.batch.insert(schema.fieldOrderEvent, {
    tenantId: ctx.tenantId,
    orderId: row.id,
    type,
    actorId: actor.id,
    message,
    payload,
    createdAt: at,
  });
}

function userById(ctx: TenantContext, id: string): UserRef {
  const user = [...ctx.users.values()].find((u) => u.id === id);
  if (!user) throw new Error(`Usuario ${id} no encontrado`);
  return user;
}

// ── Órdenes de ruta y visitas ───────────────────────────────────────────────────────────────

export interface RouteStop {
  readonly row: Row<typeof schema.routeStop>;
  readonly credit: CreditState;
}

/** El coordinador despacha una ruta: copia la vista mínima de cada cliente a su parada. */
export function dispatchRoute(
  ctx: TenantContext,
  input: {
    zone: ZoneRef;
    createdBy: UserRef;
    at: Date;
    stops: ReadonlyArray<{ credit: CreditState; collector: UserRef }>;
  },
): RouteStop[] {
  const today = businessDateOf(input.at, ctx.clock.timeZone);
  const routeId = randomUUID();
  ctx.batch.insert(schema.collectionRoute, {
    id: routeId,
    tenantId: ctx.tenantId,
    zoneId: input.zone.id,
    serviceDate: today,
    createdBy: input.createdBy.id,
    dispatchedAt: input.at,
  });
  const stops = input.stops.map(({ credit, collector }, index) => {
    const b = credit.borrower.row;
    const row: Row<typeof schema.routeStop> = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      routeId,
      creditId: credit.id,
      borrowerId: credit.borrower.id,
      collectorId: collector.id,
      sequence: index + 1,
      status: 'ASSIGNED',
      clientName: `${b.firstName} ${b.lastName ?? ''}`.trim(),
      address: b.address ?? null,
      phone: b.phone ?? null,
      lat: b.lat ?? null,
      lng: b.lng ?? null,
      amountToCollectMinor: credit.installments
        .filter((i) => i.dueDate < today)
        .reduce(
          (acc, i) => acc + Math.max(0, i.amountDueMinor - i.paidMinor),
          0,
        ),
      currency: ctx.currency,
      dispatchedAt: input.at,
      seenAt: null,
      outcome: null,
      collectedMinor: null,
      outcomeReason: null,
      promiseDate: null,
      note: null,
      paymentId: null,
      resolvedAt: null,
      cancelledBy: null,
      cancelReason: null,
      updatedAt: input.at,
    };
    ctx.batch.track(schema.routeStop, row);
    ctx.stats.routeStops += 1;
    return { row, credit };
  });
  ctx.audit({
    at: input.at,
    actorId: input.createdBy.id,
    action: 'DISPATCH collection-route',
    entity: ROUTE_ENTITY,
    entityId: routeId,
    payload: { stops: stops.length, zoneId: input.zone.id },
  });
  return stops;
}

export function seeStop(stop: RouteStop, at: Date): void {
  stop.row.status = 'SEEN';
  stop.row.seenAt = at;
  stop.row.updatedAt = at;
}

const OUTCOME_NOTE: Record<StopOutcome, string> = {
  PAID: 'Visita de ruta: pagó',
  NOT_PAID: 'Visita de ruta: no pagó',
  PROMISE: 'Visita de ruta: promesa de pago',
  NOT_FOUND: 'Visita de ruta: cliente no encontrado',
};

/** Liquidación de la visita: (si pagó) abono en efectivo + observación + visita, todo junto. */
export function resolveRouteStop(
  ctx: TenantContext,
  input: {
    stop: RouteStop;
    collector: UserRef;
    outcome: StopOutcome;
    at: Date;
    collectedMinor?: number;
    reason?: string;
    promiseDate?: string;
    note?: string;
  },
): void {
  const today = businessDateOf(input.at, ctx.clock.timeZone);
  const next = resolveStop(input.stop.row.status ?? 'ASSIGNED', {
    outcome: input.outcome,
    collectedMinor: input.outcome === 'PAID' ? input.collectedMinor : undefined,
    reason: input.reason,
    promiseDate: input.promiseDate,
    today,
  });
  let paymentId: string | null = null;
  if (input.outcome === 'PAID' && input.collectedMinor) {
    paymentId = registerCashPayment(ctx, {
      credit: input.stop.credit,
      amountMinor: input.collectedMinor,
      receivedBy: input.collector,
      at: input.at,
    });
  }
  const details = [
    input.reason,
    input.promiseDate ? `Promete pagar el ${input.promiseDate}` : undefined,
    input.note,
  ].filter(Boolean);
  addCollectionNote(ctx, {
    credit: input.stop.credit,
    author: input.collector,
    body: [OUTCOME_NOTE[input.outcome], ...details].join(' · '),
    at: input.at,
  });
  if (input.outcome !== 'NOT_FOUND')
    recordVisit(ctx, {
      credit: input.stop.credit,
      collector: input.collector,
      at: input.at,
    });
  Object.assign(input.stop.row, {
    status: next,
    outcome: input.outcome,
    collectedMinor:
      input.outcome === 'PAID' ? (input.collectedMinor ?? null) : null,
    outcomeReason: input.reason ?? null,
    promiseDate: input.promiseDate ?? null,
    note: input.note ?? null,
    paymentId,
    resolvedAt: input.at,
    updatedAt: input.at,
  });
  ctx.audit({
    at: input.at,
    actorId: input.collector.id,
    action: 'RESOLVE route-stop',
    entity: ROUTE_ENTITY,
    entityId: input.stop.row.id,
    payload: {
      outcome: input.outcome,
      collectedMinor: input.collectedMinor ?? null,
    },
  });
}

export function cancelRouteStop(
  ctx: TenantContext,
  stop: RouteStop,
  by: UserRef,
  reason: string,
  at: Date,
): void {
  Object.assign(stop.row, {
    status: 'CANCELLED',
    cancelledBy: by.id,
    cancelReason: reason,
    updatedAt: at,
  });
}

/** Observación de cobro (bitácora append-only del crédito). */
export function addCollectionNote(
  ctx: TenantContext,
  input: { credit: CreditState; author: UserRef; body: string; at: Date },
): void {
  ctx.batch.insert(schema.collectionNote, {
    tenantId: ctx.tenantId,
    creditId: input.credit.id,
    borrowerId: input.credit.borrower.id,
    authorId: input.author.id,
    body: input.body,
    createdAt: input.at,
  });
}

/** Visita con el nivel de mora del momento (base del reagendamiento por ciclo). */
export function recordVisit(
  ctx: TenantContext,
  input: { credit: CreditState; collector: UserRef; at: Date },
): number {
  const today = businessDateOf(input.at, ctx.clock.timeZone);
  const overdue = input.credit.installments.filter(
    (i) => i.dueDate < today && i.paidMinor < i.amountDueMinor,
  );
  const earliest = overdue.map((i) => i.dueDate).sort()[0] ?? null;
  const days = earliest
    ? Math.floor((Date.parse(today) - Date.parse(earliest)) / 86_400_000)
    : 0;
  ctx.batch.insert(schema.collectionVisit, {
    tenantId: ctx.tenantId,
    creditId: input.credit.id,
    borrowerId: input.credit.borrower.id,
    collectorId: input.collector.id,
    overdueCountAtVisit: overdue.length,
    daysOverdueAtVisit: days,
    visitedAt: input.at,
  });
  return overdue.length;
}
