import { randomUUID } from 'node:crypto';
import { schema } from '@preztiaos/db';
import { addDays, ConflictError, needsVisit } from '@preztiaos/domain';
import { eq } from 'drizzle-orm';
import { decidePayment } from './behavior';
import { after } from './chat';
import type { TenantContext } from './context';
import type { DayTimeline } from './clock';
import type { DayPlan } from './day-plan';
import {
  addCollectionNote,
  cancelRouteStop,
  closeCollectorDebt,
  closeDepositOrder,
  commentDeposit,
  dispatchRoute,
  issueDeposit,
  receiveRemittance,
  recordVisit,
  registerCashPayment,
  reportDepositOrder,
  requestExpense,
  resolveRouteStop,
  reviewExpenseRequest,
  seeDeposit,
  seeStop,
  submitRemittance,
  verifyDepositOrder,
  type RouteStop,
} from './field-ops';
import type {
  BorrowerState,
  BoxState,
  CreditState,
  PlanRef,
  UserRef,
} from './model';
import {
  confirmBySettlement,
  manualVerify,
  picpayWebhookPaid,
  pixPendingBank,
  pixVerifiedOnline,
  reserveForReview,
} from './pix';
import {
  assignCollector,
  balanceOf,
  createBorrower,
  grantCredit,
  isPaidOff,
  overdueCount,
} from './portfolio';
import { minor, type CollectorSpec } from './scenario';
import type { SimulationState } from './sim-state';
import {
  ensureFunds,
  sweep,
  syncBankBalance,
  weeklyCount,
  withdraw,
} from './treasury';

// PLANIFICADORES del día: cada uno agrega a la agenda las acciones de un área de la operación.
// Las reglas de negocio las aplican las funciones de escritura (que usan el dominio); aquí solo se
// decide QUÉ ocurre y CUÁNDO, de forma determinista.

const IDEMPOTENT_SHARE = 0.85;
/** Una renovación de un buen cliente también puede caer en mora (negocio que quiebra). */
const RENEWAL_DEFAULT_PROBABILITY = 0.25;
const OFFICE_FUNDING_SHARE = 0.8;
/** Días iniciales en que la conciliación automática estaba encendida (historia de la configuración). */
const AUTO_CONFIRM_DAYS = 7;
const ROUTE_STOPS = 4;
const VISIT_PROBABILITY = 0.6;
/** Últimos días sin visitas de campo: lo que entró en mora reciente queda "Por visitar". */
const RECENT_UNVISITED_DAYS = 6;
const EXPENSES: ReadonlyArray<{ description: string; amount: number }> = [
  { description: 'Gasolina de la moto (ruta del día)', amount: 50 },
  { description: 'Almuerzo en ruta', amount: 25 },
  { description: 'Mantenimiento de la moto: cambio de aceite', amount: 120 },
  { description: 'Recarga de datos del celular', amount: 20 },
  { description: 'Parqueadero en zona centro', amount: 12 },
];
const PETTY_EXPENSES: ReadonlyArray<{ description: string; amount: number }> = [
  { description: 'Papelería y tóner de impresora', amount: 85 },
  { description: 'Internet de la oficina', amount: 120 },
  { description: 'Café y productos de aseo', amount: 45 },
];
const REJECTION_REASONS = [
  'Sin comprobante legible del gasto',
  'El gasto no corresponde a la ruta asignada',
];

// ── Créditos nuevos y renovaciones ──────────────────────────────────────────────────────────

export interface FirstCredit {
  readonly collector: CollectorSpec;
  readonly profileIndex: number;
}

export function planGrants(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
  firsts: readonly FirstCredit[],
): void {
  let slot = 0;
  for (const first of firsts) {
    plan.add(8, 30 + 6 * slot++, (at) => {
      const collector = ctx.user(first.collector.userKey);
      const zone = ctx.zone(first.collector.zoneKey);
      const borrower = createBorrower(ctx, {
        zone,
        collector,
        profile: first.collector.profiles[first.profileIndex]!,
        at: new Date(at.getTime() - 120_000),
        color: colorFor(first.collector.profiles[first.profileIndex]!),
      });
      state.collectorOf.set(borrower.id, collector);
      grantFor(ctx, state, {
        borrower,
        collector: first.collector,
        at,
        renewal: false,
      });
    });
  }
  for (const borrower of state.renewals.get(date) ?? []) {
    plan.add(9, 20 + 6 * slot++, (at) => {
      const spec = ctx.scenario.collectors.find(
        (c) => c.userKey === state.collectorOf.get(borrower.id)?.key,
      );
      if (!spec || borrower.row.creditBlocked) return;
      grantFor(ctx, state, { borrower, collector: spec, at, renewal: true });
    });
  }
}

function grantFor(
  ctx: TenantContext,
  state: SimulationState,
  input: {
    borrower: BorrowerState;
    collector: CollectorSpec;
    at: Date;
    renewal: boolean;
  },
): CreditState | null {
  const options = ctx.scenario.principalOptions;
  const tier = input.renewal
    ? ctx.random.int(3, options.length - 1)
    : ctx.random.int(0, 4);
  const plan = pickPlan(ctx);
  const office = ctx.box(input.collector.officeBoxKey);
  const treasury = treasuryBox(ctx);
  const funding = ctx.random.chance(OFFICE_FUNDING_SHARE) ? office : treasury;
  const limit = input.borrower.row.creditLimitMinor ?? 0;
  const principal =
    limit > 0 ? Math.min(options[tier]!, limit) : options[tier]!;
  ensureFunds(ctx, {
    box: funding,
    amountMinor: principal,
    treasury,
    actor: ctx.admin,
    at: input.at,
  });
  try {
    const credit = grantCredit(ctx, {
      borrower: input.borrower,
      principalMinor: principal,
      plan,
      fundingBox: funding,
      grantedBy: ctx.coordinatorFor(input.borrower.zone),
      at: input.at,
    });
    if (
      input.borrower.profile === 'DEFAULTER' ||
      (input.renewal && ctx.random.chance(RENEWAL_DEFAULT_PROBABILITY))
    ) {
      credit.stopsPayingOn = addDays(
        credit.row.startDate,
        ctx.random.int(3, 9),
      );
    }
    return credit;
  } catch (err) {
    // El cupo del cliente no alcanza para la renovación: el coordinador no la otorga.
    if (
      err instanceof ConflictError &&
      (err.code === 'OVER_LIMIT' || err.code === 'BLOCKED')
    )
      return null;
    throw err;
  }
}

export function pickPlan(ctx: TenantContext): PlanRef {
  const weighted = ctx.scenario.plans.flatMap((p) =>
    Array.from({ length: p.weight }, () => p.key),
  );
  return ctx.plan(ctx.random.pick(weighted));
}

export function treasuryBox(ctx: TenantContext): BoxState {
  return ctx.boxes.get('bankInter') ?? ctx.box('bank');
}

function colorFor(
  profile: BorrowerState['profile'],
): BorrowerState['row']['color'] {
  return (
    {
      PUNCTUAL: 'GREEN',
      LATE: 'YELLOW',
      PARTIAL: 'ORANGE',
      DEFAULTER: 'RED',
      PIX: 'BLUE',
      SETTLER: 'GREEN',
    } as const
  )[profile];
}

/** Al saldar un crédito, los buenos clientes renuevan en 1–3 días (si su cupo lo permite). */
export function queueRenewalIfPaid(
  ctx: TenantContext,
  state: SimulationState,
  credit: CreditState,
  date: string,
): void {
  if (
    !isPaidOff(credit) ||
    credit.borrower.profile === 'DEFAULTER' ||
    credit.borrower.profile === 'PARTIAL'
  )
    return;
  const renewOn = addDays(date, ctx.random.int(1, 3));
  if (renewOn > ctx.clock.today) return;
  const queue = state.renewals.get(renewOn) ?? [];
  if (!queue.includes(credit.borrower)) queue.push(credit.borrower);
  state.renewals.set(renewOn, queue);
}

// ── Cobro del día (efectivo en ruta y PIX por chat) ─────────────────────────────────────────

export function planCollections(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  const sunday = ctx.clock.isSunday(date);
  const slots = new Map<string, number>();
  for (const credit of activeCredits(ctx, date)) {
    if (state.routedToday.has(credit.id)) continue;
    const collector = state.collectorOf.get(credit.borrower.id);
    if (!collector || !collector.row.active) continue;
    const intent = decidePayment(ctx.random, credit, date, sunday);
    if (!intent) continue;
    const amount = intent.amountMinor - (state.pendingPix.get(credit.id) ?? 0);
    if (amount <= 0) continue;
    if (intent.channel === 'PIX' && ctx.scenario.features.pix) {
      plan.add(ctx.random.int(7, 20), ctx.random.int(0, 59), (at) =>
        payByPix(ctx, state, { credit, amount, at, date }),
      );
      continue;
    }
    const slot = slots.get(collector.id) ?? 0;
    slots.set(collector.id, slot + 1);
    plan.add(
      8 + Math.floor((30 + slot * 14) / 60),
      (30 + slot * 14) % 60,
      (at) => {
        const due = Math.min(amount, balanceOf(credit));
        if (due <= 0) return;
        registerCashPayment(ctx, {
          credit,
          amountMinor: due,
          receivedBy: collector,
          at,
          idempotencyKey: ctx.random.chance(IDEMPOTENT_SHARE)
            ? randomUUID()
            : null,
        });
        queueRenewalIfPaid(ctx, state, credit, date);
      },
    );
  }
}

/** Créditos activos con saldo que ya empezaron (el día del desembolso no se cobra). */
export function activeCredits(ctx: TenantContext, date: string): CreditState[] {
  return ctx.credits.filter(
    (c) =>
      c.row.status === 'ACTIVE' && c.row.startDate < date && balanceOf(c) > 0,
  );
}

async function payByPix(
  ctx: TenantContext,
  state: SimulationState,
  input: { credit: CreditState; amount: number; at: Date; date: string },
): Promise<void> {
  const { credit, at, date } = input;
  const amount = Math.min(
    input.amount,
    balanceOf(credit) - (state.pendingPix.get(credit.id) ?? 0),
  );
  if (amount <= 0) return;
  const picpay = ctx.accounts.get('picpay');
  const inter = ctx.accounts.get('inter');
  // Dos de cada tres clientes pagan a PicPay; la elección sale de su cédula (semilla), no del id.
  const usesPicpay =
    picpay && Number(credit.borrower.nationalId.slice(-1)) % 3 !== 0;
  if (!usesPicpay || !picpay) {
    const receipt = await pixVerifiedOnline(ctx, {
      credit,
      amountMinor: amount,
      account: inter!,
      at,
    });
    state.receipts.push(receipt);
    queueRenewalIfPaid(ctx, state, credit, date);
    return;
  }
  const receipt = await pixPendingBank(ctx, {
    credit,
    amountMinor: amount,
    account: picpay,
    at,
  });
  state.receipts.push(receipt);
  const isToday = date === ctx.clock.today;
  if (isToday && ctx.random.chance(0.5)) {
    state.addPendingPix(credit.id, amount); // el banco aún no lo reporta (sin webhook todavía)
    return;
  }
  const webhookAt = after(at, 90);
  const incoming = picpayWebhookPaid(ctx, {
    account: picpay,
    amountMinor: amount,
    endToEndId: receipt.endToEndId,
    at: webhookAt,
  });
  if (state.days.indexOf(date) < AUTO_CONFIRM_DAYS) {
    confirmBySettlement(ctx, receipt, incoming, webhookAt);
    queueRenewalIfPaid(ctx, state, credit, date);
    return;
  }
  reserveForReview(ctx, receipt, incoming, webhookAt);
  state.addPendingPix(credit.id, amount);
  if (date < addDays(ctx.clock.today, -1))
    state.picpayToVerify.push({
      receipt,
      reserved: incoming,
      amountMinor: amount,
    });
}

/** Validación humana, al final de la tarde, de los PIX conciliados que esperan aprobación. */
export function planPicpayReviews(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  plan.add(18, 40, (at) => {
    for (const review of state.picpayToVerify.splice(0)) {
      manualVerify(ctx, {
        receipt: review.receipt,
        decidedBy: ctx.coordinatorFor(review.receipt.credit.zone),
        reason: 'Crédito real de PicPay conciliado con el comprobante',
        at,
        reserved: review.reserved,
      });
      state.clearPendingPix(review.receipt.credit.id, review.amountMinor);
      queueRenewalIfPaid(ctx, state, review.receipt.credit, date);
    }
  });
}

// ── Órdenes de ruta y visitas ───────────────────────────────────────────────────────────────

export function planRoutes(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  if (!ctx.scenario.features.routes) return;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const today = date === ctx.clock.today;
  if (!today && weekday !== 2 && weekday !== 4) return;
  for (const spec of ctx.scenario.collectors.filter((c) => state.isActive(c))) {
    const collector = ctx.user(spec.userKey);
    const candidates = activeCredits(ctx, date)
      .filter(
        (c) =>
          state.collectorOf.get(c.borrower.id)?.id === collector.id &&
          overdueCount(c, date) >= 1,
      )
      .sort((a, b) => overdueCount(b, date) - overdueCount(a, date))
      .slice(0, ROUTE_STOPS);
    if (candidates.length === 0) continue;
    for (const credit of candidates) state.routedToday.add(credit.id);
    const zone = ctx.zone(spec.zoneKey);
    const stops: RouteStop[] = [];
    plan.add(8, 0, (at) => {
      stops.push(
        ...dispatchRoute(ctx, {
          zone,
          createdBy: ctx.coordinatorFor(zone),
          at,
          stops: candidates.map((credit) => ({ credit, collector })),
        }),
      );
    });
    candidates.forEach((_, index) => {
      plan.add(10 + index, 20, (at) => {
        const stop = stops[index];
        if (!stop) return;
        if (today) {
          resolveTodayStop(ctx, state, stop, collector, index, at);
          return;
        }
        seeStop(stop, new Date(at.getTime() - 300_000));
        resolveHistoricalStop(ctx, state, stop, collector, date, at);
      });
    });
  }
}

function resolveHistoricalStop(
  ctx: TenantContext,
  state: SimulationState,
  stop: RouteStop,
  collector: UserRef,
  date: string,
  at: Date,
): void {
  const { credit } = stop;
  if (ctx.random.chance(0.08)) {
    cancelRouteStop(
      ctx,
      stop,
      ctx.coordinatorFor(credit.zone),
      'El cliente pagó por PIX antes de la visita',
      at,
    );
    return;
  }
  const due = Math.min(stop.row.amountToCollectMinor, balanceOf(credit));
  if (!credit.stopsPayingOn && due > 0) {
    const collected = ctx.random.chance(0.7)
      ? due
      : Math.max(100, Math.round(due / 200) * 100);
    resolveRouteStop(ctx, {
      stop,
      collector,
      outcome: 'PAID',
      at,
      collectedMinor: Math.min(collected, due),
      note: 'Pagó en el local',
    });
    state.lastVisit.set(credit.id, overdueCount(credit, date));
    queueRenewalIfPaid(ctx, state, credit, date);
    return;
  }
  const roll = ctx.random.next();
  if (roll < 0.4) {
    resolveRouteStop(ctx, {
      stop,
      collector,
      outcome: 'PROMISE',
      at,
      promiseDate: addDays(date, 2),
      note: 'Pide dos días, espera un pago de un cliente',
    });
  } else if (roll < 0.8) {
    resolveRouteStop(ctx, {
      stop,
      collector,
      outcome: 'NOT_PAID',
      at,
      reason: 'Sin dinero hoy, las ventas están bajas',
    });
  } else {
    resolveRouteStop(ctx, {
      stop,
      collector,
      outcome: 'NOT_FOUND',
      at,
      note: 'Local cerrado, vecinos dicen que viajó',
    });
    return;
  }
  state.lastVisit.set(credit.id, overdueCount(credit, date));
}

/** Hoy la ruta queda a medias: una liquidada, una vista, una asignada y una cancelada. */
function resolveTodayStop(
  ctx: TenantContext,
  state: SimulationState,
  stop: RouteStop,
  collector: UserRef,
  index: number,
  at: Date,
): void {
  if (index === 0) {
    seeStop(stop, new Date(at.getTime() - 300_000));
    const due = Math.min(stop.row.amountToCollectMinor, balanceOf(stop.credit));
    if (stop.credit.stopsPayingOn) {
      resolveRouteStop(ctx, {
        stop,
        collector,
        outcome: 'PROMISE',
        at,
        promiseDate: addDays(ctx.clock.today, 1),
        note: 'Promete abonar mañana a primera hora',
      });
      state.lastVisit.set(
        stop.credit.id,
        overdueCount(stop.credit, ctx.clock.today),
      );
    } else if (due > 0) {
      resolveRouteStop(ctx, {
        stop,
        collector,
        outcome: 'PAID',
        at,
        collectedMinor: due,
        note: 'Pagó lo vencido',
      });
    }
  } else if (index === 1) {
    seeStop(stop, at);
  } else if (index === 3) {
    cancelRouteStop(
      ctx,
      stop,
      ctx.coordinatorFor(stop.credit.zone),
      'El cliente envió el comprobante PIX por WhatsApp',
      at,
    );
  }
}

/** Visitas de cobro (pestaña "Visitas"): observación + visita cuando la mora alcanza el umbral. */
export function planVisits(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const today = date === ctx.clock.today;
  if (!today && ![1, 3, 5].includes(weekday)) return;
  const threshold = ctx.settings.visitOverdueThreshold;
  let leftFreshObservation = false;
  for (const credit of activeCredits(ctx, date)) {
    const collector = state.collectorOf.get(credit.borrower.id);
    if (!collector?.row.active || state.routedToday.has(credit.id)) continue;
    const overdue = overdueCount(credit, date);
    if (
      !needsVisit({
        overdueCount: overdue,
        threshold,
        lastVisitOverdueCount: state.lastVisit.get(credit.id) ?? null,
      })
    )
      continue;
    if (today) {
      // Hoy: una observación nueva sin visita aún (el botón "marcar visitado" queda habilitado).
      if (leftFreshObservation) continue;
      leftFreshObservation = true;
      plan.add(15, 0, (at) =>
        addCollectionNote(ctx, {
          credit,
          author: collector,
          body: 'Cliente atendió; dice que paga el viernes cuando cobre a sus clientes',
          at,
        }),
      );
      continue;
    }
    // Lo que entró en mora los últimos días aún no se visita: queda en "Por visitar".
    if (
      date >= addDays(ctx.clock.today, -RECENT_UNVISITED_DAYS) ||
      !ctx.random.chance(VISIT_PROBABILITY)
    )
      continue;
    plan.add(15, ctx.random.int(0, 50), (at) => {
      addCollectionNote(ctx, {
        credit,
        author: collector,
        body: ctx.random.pick(VISIT_NOTES),
        at,
      });
      const count = recordVisit(ctx, { credit, collector, at: after(at, 240) });
      state.lastVisit.set(credit.id, count);
    });
  }
}

const VISIT_NOTES = [
  'Visitado en el local: reconoce la deuda y propone abonar la mitad el lunes',
  'No estaba; se dejó razón con el empleado del negocio',
  'Cliente con el negocio cerrado por remodelación; promete ponerse al día',
  'Visitado: dice que tuvo una calamidad familiar, pide plazo de una semana',
];

// ── Gastos de cobro (maker-checker) ─────────────────────────────────────────────────────────

export function planExpenses(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  const index = state.days.indexOf(date);
  const today = date === ctx.clock.today;
  for (const review of state.pendingReviews.splice(0)) {
    plan.add(8, 45, (at) => {
      const office = ctx.box(review.collector.officeBoxKey);
      if (review.approve && office.balance >= review.expense.row.amountMinor) {
        reviewExpenseRequest(ctx, {
          expense: review.expense,
          reviewer: ctx.coordinatorFor(ctx.zone(review.collector.zoneKey)),
          at,
          approveFrom: office,
        });
      } else {
        reviewExpenseRequest(ctx, {
          expense: review.expense,
          reviewer: ctx.coordinatorFor(ctx.zone(review.collector.zoneKey)),
          at,
          rejectionReason: ctx.random.pick(REJECTION_REASONS),
        });
      }
    });
  }
  ctx.scenario.collectors.forEach((spec, position) => {
    if (
      !state.isActive(spec) ||
      ctx.clock.isSunday(date) ||
      (index + position) % 5 !== 0
    )
      return;
    const item = ctx.random.pick(EXPENSES);
    const collector = ctx.user(spec.userKey);
    const zone = ctx.zone(spec.zoneKey);
    const mode = ctx.random.next();
    plan.add(12, 30, async (at) => {
      const expense = await requestExpense(ctx, {
        requestedBy: collector,
        zone,
        description: item.description,
        amountMinor: minor(item.amount),
        at,
      });
      if (today) return; // queda pendiente de revisión
      if (mode < 0.7) {
        plan.add(16, 10, (reviewAt) => {
          const route = ctx.routeBoxOf(collector.id);
          if (route.balance >= expense.row.amountMinor) {
            reviewExpenseRequest(ctx, {
              expense,
              reviewer: ctx.coordinatorFor(zone),
              at: reviewAt,
              approveFrom: route,
            });
          } else {
            state.pendingReviews.push({
              expense,
              collector: spec,
              approve: true,
            });
          }
        });
      } else {
        state.pendingReviews.push({
          expense,
          collector: spec,
          approve: mode < 0.85,
        });
      }
    });
  });
}

/** Gastos de la oficina (los pide y aprueba el ADMIN) pagados desde la caja menor. */
export function planPettyExpenses(
  ctx: TenantContext,
  plan: DayPlan,
  date: string,
): void {
  const petty = ctx.boxes.get('petty');
  if (!petty || new Date(`${date}T00:00:00Z`).getUTCDay() !== 5) return;
  const item = ctx.random.pick(PETTY_EXPENSES);
  plan.add(11, 0, async (at) => {
    const amount = minor(item.amount);
    if (petty.balance < amount) return;
    const expense = await requestExpense(ctx, {
      requestedBy: ctx.admin,
      zone: null,
      description: item.description,
      amountMinor: amount,
      at,
    });
    reviewExpenseRequest(ctx, {
      expense,
      reviewer: ctx.admin,
      at: after(at, 300),
      approveFrom: petty,
    });
  });
}

// ── Consignaciones del cobrador (ruta → cuenta) ─────────────────────────────────────────────

export function planDeposits(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  if (!ctx.scenario.features.deposits) return;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const today = date === ctx.clock.today;
  for (const spec of ctx.scenario.collectors.filter(
    (c) => c.style === 'DEPOSITS' && state.isActive(c),
  )) {
    if (
      !today &&
      weekday !== 3 &&
      weekday !== 5 &&
      date !== addDays(ctx.clock.today, -1)
    )
      continue;
    const collector = ctx.user(spec.userKey);
    const coordinator = ctx.coordinatorFor(ctx.zone(spec.zoneKey));
    const book = state.book(collector);
    const destination = ctx.box('bankPicpay');
    const picpay = ctx.account('picpay');
    const yesterday = date === addDays(ctx.clock.today, -1);
    plan.add(13, 0, async (at, timeline) => {
      const amount =
        Math.floor((book.box.balance * 0.7) / minor(10)) * minor(10);
      if (amount < minor(100)) return;
      const issued = (state.depositsIssued.get(collector.id) ?? 0) + 1;
      state.depositsIssued.set(collector.id, issued);
      const variant = today
        ? 'TODAY'
        : yesterday
          ? 'DISPUTED_OPEN'
          : issued === 3
            ? 'DISPUTE'
            : issued === 5
              ? 'CANCEL'
              : 'NORMAL';
      const order = issueDeposit(ctx, {
        book,
        destination,
        amountMinor: amount,
        issuedBy: coordinator,
        instructions:
          'Consigna el efectivo del día en la cuenta PicPay y sube el comprobante',
        at,
      });
      if (variant === 'CANCEL') {
        seeDeposit(ctx, order, timeline.at(13, 10));
        closeDepositOrder(ctx, {
          order,
          actor: coordinator,
          action: 'CANCELLED',
          reason: 'Se recoge en la rendición de hoy',
          at: timeline.at(13, 40),
        });
        return;
      }
      seeDeposit(ctx, order, timeline.at(13, 10));
      const depositedAt = timeline.at(13, 50);
      const credit = picpayWebhookPaid(ctx, {
        account: picpay,
        amountMinor: amount,
        endToEndId: null,
        merchantChargeId: `deposit-${order.row.id.slice(0, 8)}`,
        at: timeline.at(13, 52),
      });
      const firstReport =
        variant === 'DISPUTE' || variant === 'DISPUTED_OPEN'
          ? amount - minor(20)
          : amount;
      await reportDepositOrder(ctx, {
        order,
        amountMinor: firstReport,
        depositedAt,
        reference: `PIX-${ctx.random.digits(8)}`,
        note: 'Consignado en el corresponsal del centro',
        at: timeline.at(14, 0),
      });
      if (variant === 'TODAY') return; // queda REPORTADA esperando la verificación del coordinador
      if (variant === 'DISPUTED_OPEN') {
        // Objetada y sin corregir: el cobrador debe reportar de nuevo (el dinero sigue en su ruta).
        closeDepositOrder(ctx, {
          order,
          actor: coordinator,
          action: 'DISPUTED',
          reason: 'No aparece el ingreso en PicPay con ese valor',
          at: timeline.at(14, 30),
        });
        commentDeposit(
          ctx,
          order,
          collector,
          'Lo consigné en el corresponsal; mañana llevo el comprobante físico',
          timeline.at(14, 45),
        );
        return;
      }
      if (variant === 'DISPUTE') {
        closeDepositOrder(ctx, {
          order,
          actor: coordinator,
          action: 'DISPUTED',
          reason: 'El monto reportado no coincide con el ingreso del banco',
          at: timeline.at(14, 30),
        });
        commentDeposit(
          ctx,
          order,
          collector,
          'Me equivoqué al digitar: el valor correcto es el del comprobante',
          timeline.at(14, 40),
        );
        await reportDepositOrder(ctx, {
          order,
          amountMinor: amount,
          depositedAt,
          reference: `PIX-${ctx.random.digits(8)}`,
          note: 'Corrijo el valor',
          at: timeline.at(15, 0),
        });
      }
      verifyDepositOrder(ctx, {
        order,
        book,
        verifier: coordinator,
        amountMinor: amount,
        bankCredit: credit.row,
        note: 'Ingreso confirmado en PicPay',
        at: timeline.at(15, 30),
      });
    });
    if (today) {
      plan.add(16, 0, (at) => {
        const amount =
          Math.floor((book.box.balance * 0.3) / minor(10)) * minor(10);
        if (amount >= minor(50))
          issueDeposit(ctx, {
            book,
            destination,
            amountMinor: amount,
            issuedBy: coordinator,
            instructions: 'Consigna lo de la tarde antes de las 18:00',
            at,
          });
      });
    }
  }
}

// ── Rendición de cuentas y cierre de deuda ──────────────────────────────────────────────────

export function planRemittances(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  const today = date === ctx.clock.today;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const week = state.weekOf(date);
  ctx.scenario.collectors.forEach((spec) => {
    if (!state.isActive(spec)) return;
    const collector = ctx.user(spec.userKey);
    const book = state.book(collector);
    const office = ctx.box(spec.officeBoxKey);
    const coordinator = ctx.coordinatorFor(ctx.zone(spec.zoneKey));
    const retiring = state.retirementDate(spec) === date;
    let shortfall = 0;
    let submitHour = ctx.settings.remittanceDeadlineHourLocal - 1;
    let submitMinute = ctx.random.int(0, 20);
    // Estos cobradores no reponen el faltante: queda como deuda hasta que el ADMIN la cierra.
    const keepsDebt =
      spec.style === 'LATE_AND_SHORT' || spec.style === 'SHORT_ONCE';
    if (today && spec.style !== 'EXACT' && spec.style !== 'SHORT_ONCE') return; // obligación pendiente o atrasada
    if (
      spec.style === 'DEPOSITS' &&
      (weekday === 6 || date === addDays(ctx.clock.today, -1))
    )
      return; // no rindió
    if (spec.style === 'LATE_AND_SHORT' && weekday === 2)
      [submitHour, submitMinute] = [submitHour + 2, 10];
    if (spec.style === 'LATE_AND_SHORT' && weekday === 4 && week % 2 === 1)
      shortfall = minor(ctx.random.int(15, 40));
    if (spec.style === 'SHORT_ONCE' && week === 2 && weekday === 4)
      shortfall = minor(35);
    if (retiring) shortfall = minor(60);
    plan.add(submitHour, submitMinute, (at, timeline) => {
      if (!book.hasUnremittedCollections && book.box.balance <= 0) {
        if (retiring) retire(ctx, state, spec, timeline);
        return;
      }
      const expected = book.summary.expectedMinor;
      const carried = keepsDebt ? book.carriedDebt : 0;
      const short = Math.min(shortfall + carried, expected);
      submitRemittance(ctx, {
        book,
        declaredMinor: expected - short,
        note:
          short > carried
            ? 'Me faltó un cliente por cobrar el billete; lo repongo mañana'
            : null,
        at,
      });
      if (today && spec.style === 'EXACT') return; // declarada, esperando recepción
      receiveRemittance(ctx, {
        book,
        receiver: coordinator,
        countedMinor: expected - short,
        destination: office,
        note:
          short > carried
            ? 'Faltante registrado como deuda del cobrador'
            : null,
        timeline,
        hour: submitHour,
        minute: submitMinute + 25,
      });
      if (retiring) retire(ctx, state, spec, timeline);
    });
  });
}

/** Retiro del cobrador: se condona su deuda, se desactiva su caja y usuario y su cartera pasa a otro. */
function retire(
  ctx: TenantContext,
  state: SimulationState,
  spec: CollectorSpec,
  timeline: DayTimeline,
): void {
  const collector = ctx.user(spec.userKey);
  const book = state.book(collector);
  const debt = book.carriedDebt;
  if (debt > 0) {
    closeCollectorDebt(ctx, {
      book,
      type: 'WRITE_OFF',
      amountMinor: debt,
      reason: 'Retiro del cobrador: faltante final condonado',
      at: timeline.at(20, 30),
    });
  }
  const at = timeline.at(20, 40);
  const box = ctx.box(spec.routeBoxKey);
  Object.assign(box.row, { active: false, updatedAt: at });
  Object.assign(collector.row, { active: false, updatedAt: at });
  ctx.batch.track(schema.cashBox, box.row);
  ctx.batch.track(schema.appUser, collector.row);
  state.retired.add(spec.userKey);
  const successor = ctx.user(spec.handoverTo!);
  const zone = ctx.zone(spec.zoneKey);
  for (const borrower of ctx.borrowers.filter(
    (b) => state.collectorOf.get(b.id)?.id === collector.id,
  )) {
    state.collectorOf.set(borrower.id, successor);
    assignCollector(ctx, borrower.id, successor, zone, at);
  }
  ctx.afterFlush.push(async () => {
    await ctx.db
      .delete(schema.collectorClient)
      .where(eq(schema.collectorClient.collectorId, collector.id));
  });
  ctx.audit({
    at,
    actorId: ctx.admin.id,
    action: 'PATCH /users/:id',
    entity: 'users',
    entityId: collector.id,
    payload: { active: false },
  });
}

/** Cierre de deuda (lunes, ADMIN): nómina para uno, condonación para otro. */
export function planDebtClosures(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  if (
    new Date(`${date}T00:00:00Z`).getUTCDay() !== 1 ||
    date === ctx.clock.today
  )
    return;
  const week = state.weekOf(date);
  for (const spec of ctx.scenario.collectors.filter((c) => state.isActive(c))) {
    const book = state.book(ctx.user(spec.userKey));
    const payroll =
      spec.style === 'LATE_AND_SHORT' && (week === 3 || week === 6);
    const writeOff = spec.style === 'SHORT_ONCE';
    if (!payroll && !writeOff) continue;
    plan.add(8, 30, (at) => {
      const debt = book.carriedDebt;
      if (debt <= 0 || book.open) return;
      closeCollectorDebt(ctx, {
        book,
        type: payroll ? 'PAYROLL' : 'WRITE_OFF',
        amountMinor: debt,
        reason: payroll
          ? 'Se descuenta del pago de nómina de la quincena'
          : 'Faltante menor condonado por la gerencia',
        at,
      });
    });
  }
}

// ── Tesorería de oficina ────────────────────────────────────────────────────────────────────

export function planTreasury(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const index = state.days.indexOf(date);
  const week = state.weekOf(date);
  const treasury = treasuryBox(ctx);
  const offices = ctx.scenario.boxes
    .filter((b) => b.type === 'CASH' && b.zoneKey && !b.assignedToKey)
    .map((b) => ctx.box(b.key));
  if (weekday === 1 && date !== ctx.clock.today) {
    offices.forEach((office, i) => {
      plan.add(7, 30 + i * 5, (at) => {
        const performer = office.zonePath
          ? ctx.coordinatorFor(
              [...ctx.zones.values()].find((z) => z.path === office.zonePath)!,
            )
          : ctx.admin;
        if (week === 3 && i === 0)
          weeklyCount(ctx, {
            box: office,
            performedBy: performer,
            at,
            differenceMinor: -minor(35),
            adjustReason:
              'Faltante en arqueo: billete falso detectado y retenido',
          });
        else if (week === 5 && i === 1)
          weeklyCount(ctx, {
            box: office,
            performedBy: performer,
            at,
            differenceMinor: minor(12),
            adjustReason:
              'Sobrante en arqueo: cambio no entregado a un cliente',
          });
        else weeklyCount(ctx, { box: office, performedBy: performer, at });
      });
    });
    plan.add(8, 0, (at) => {
      for (const box of [...ctx.boxes.values()].filter(
        (b) => b.type === 'BANK' && b.row.active,
      )) {
        const account = [...ctx.accounts.values()].find(
          (a) => a.id === box.bankAccountId,
        );
        const bankMinor =
          account?.providerType === 'INTER'
            ? box.balance
            : account?.providerType === 'MERCADOPAGO'
              ? box.balance + 1234
              : null;
        syncBankBalance(ctx, { box, syncedBy: ctx.admin, at, bankMinor });
      }
    });
    const petty = ctx.boxes.get('petty');
    const mainOffice = offices[0];
    if (petty && mainOffice) {
      plan.add(9, 0, (at) => {
        if (petty.balance < minor(300) && mainOffice.balance > minor(1000)) {
          ctx.ledger.transfer({
            from: mainOffice,
            to: petty,
            amountMinor: minor(500),
            reason: 'Reposición de caja menor',
            at,
            createdBy: ctx.admin.id,
          });
        }
      });
    }
  }
  if (weekday === 5) {
    plan.add(17, 0, (at) => {
      for (const office of offices)
        sweep(ctx, {
          from: office,
          to: treasury,
          aboveMinor: minor(25000),
          keepMinor: minor(10000),
          reason: 'Consignación de excedentes de caja a tesorería',
          actor: ctx.admin,
          at,
        });
      const picpay = ctx.boxes.get('bankPicpay');
      if (picpay)
        sweep(ctx, {
          from: picpay,
          to: treasury,
          aboveMinor: minor(8000),
          keepMinor: minor(2000),
          reason: 'Traslado del recaudo PicPay a la tesorería',
          actor: ctx.admin,
          at,
        });
    });
  }
  if (index === 15 && offices[1])
    plan.add(10, 0, (at) =>
      withdraw(
        ctx,
        offices[1]!,
        minor(1200),
        'Pago del arriendo del punto de atención',
        ctx.admin,
        at,
      ),
    );
  if (index === 28 || index === 56)
    plan.add(10, 30, (at) =>
      withdraw(
        ctx,
        treasury,
        minor(4000),
        'Retiro de utilidades de los socios',
        ctx.admin,
        at,
      ),
    );
}
