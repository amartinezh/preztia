import { randomUUID } from 'node:crypto';
import { schema } from '@preztiaos/db';
import {
  addDays,
  buildCollectionReminderMessage,
  formatMoneyMinor,
  type HistoricalPayment,
} from '@preztiaos/domain';
import { after, chatIn, chatOut } from './chat';
import type { DayTimeline } from './clock';
import type { TenantContext } from './context';
import type { DayPlan } from './day-plan';
import { jitterLocation, testPhone } from './fake-data';
import { addCollectionNote, registerCashPayment } from './field-ops';
import type {
  BorrowerState,
  CreditState,
  PayerProfile,
  Row,
  UserRef,
} from './model';
import {
  manualVerify,
  picpayWebhookPaid,
  picpayWebhookStatus,
  pixDuplicateIgnored,
  pixOrphan,
  pixPendingBank,
  pixRejectedDuplicate,
  pixToUnknownKey,
  pixUnreadable,
  pixVerifiedOnline,
  receiveReceipt,
  reserveForReview,
  type Receipt,
} from './pix';
import { treasuryBox } from './planners';
import {
  balanceOf,
  createBorrower,
  grantCredit,
  nextInstallmentMinor,
  overdueCount,
  paymentRow,
  registerMigratedCredit,
} from './portfolio';
import { minor } from './scenario';
import type { SimulationState } from './sim-state';
import { ensureFunds, weeklyCount } from './treasury';

// CASOS VITRINA: hechos puntuales que la operación diaria no produce sola pero que la app debe
// mostrar (créditos migrados y sus estados heredados, interés personalizado, cupos, bloqueos, cada
// desenlace raro de un comprobante PIX, cobros conversacionales, fechas de pago atrasadas, listas,
// solicitudes de cambio, Telegram, recordatorios y el recorrido GPS de los cobradores).

const daysAgoOf = (ctx: TenantContext, date: string) =>
  Math.round((Date.parse(ctx.clock.today) - Date.parse(date)) / 86_400_000);

export function planShowcase(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  const index = state.days.indexOf(date);
  const ago = daysAgoOf(ctx, date);
  if (index === 0 && ctx.scenario.features.migrations)
    plan.add(7, 0, (at) => loadMigratedCredits(ctx, state, date, at));
  if (index === 2)
    plan.add(9, 40, (at) => customInterestCredit(ctx, state, at));
  if (ago === 18) plan.add(9, 50, (at) => parallelCredit(ctx, at));
  if (ago === 12) plan.add(9, 45, (at) => creditAtLimit(ctx, state, at));
  if (ago === 10) {
    plan.add(11, 0, (at) => blockDefaulter(ctx, at));
    plan.add(12, 0, (at) => prospects(ctx, at));
  }
  if (ctx.scenario.features.pix) planPixShowcase(ctx, state, plan, ago);
  if (ago === 9 || ago === 2) planOfflineCaptures(ctx, state, plan, date);
  if (ago >= 1 && ago <= 7 && ctx.clock.isWeekday(date, WEDNESDAY))
    plan.add(10, 15, (at) =>
      officePayment(ctx, state, {
        at,
        paidOn: addDays(date, -1),
        by: ctx.admin,
      }),
    );
  if (ago === 0)
    plan.add(11, 45, (at) =>
      officePayment(ctx, state, { at, paidOn: null, by: null }),
    );
  if (ago === 20) plan.add(16, 0, (at) => telegramLinks(ctx, at));
  if (ago === 3) plan.add(16, 0, (at) => borrowerLists(ctx, at));
  if (ago === 15 || ago === 9 || ago === 4)
    plan.add(14, 0, (at) => changeRequest(ctx, state, ago, at));
  if (ago === 20 || ago === 6 || ago === 30)
    plan.add(17, 0, (at) => borrowerNotes(ctx, at));
  if (ago === 3 || ago === 1)
    plan.add(8, 5, (at) => manualReminders(ctx, state, at));
  if (ago <= 2) plan.add(8, 0, () => collectorTracks(ctx, state, date));
  if (ago === 0) plan.add(23, 50, (at) => pendingPettyCount(ctx, at));
}

// ── Créditos migrados del sistema anterior ──────────────────────────────────────────────────

interface MigrationDraft {
  readonly zoneKey: string;
  readonly profile: PayerProfile;
  readonly planKey: string;
  readonly principal: number;
  readonly startOffset: number;
  readonly payments: number;
  readonly legacyStatus?: 'DEFAULTED' | 'CANCELLED';
}

const MIGRATIONS: readonly MigrationDraft[] = [
  {
    zoneKey: 'div',
    profile: 'PUNCTUAL',
    planKey: 'd24',
    principal: minor(1000),
    startOffset: -12,
    payments: 10,
  },
  {
    zoneKey: 'bh',
    profile: 'LATE',
    planKey: 'w8',
    principal: minor(1500),
    startOffset: -20,
    payments: 2,
  },
  {
    zoneKey: 'spc',
    profile: 'PUNCTUAL',
    planKey: 'd20',
    principal: minor(500),
    startOffset: -25,
    payments: 20,
  },
  {
    zoneKey: 'cps',
    profile: 'DEFAULTER',
    planKey: 'd20',
    principal: minor(800),
    startOffset: -30,
    payments: 5,
    legacyStatus: 'DEFAULTED',
  },
  {
    zoneKey: 'div',
    profile: 'PUNCTUAL',
    planKey: 'm3',
    principal: minor(2000),
    startOffset: -40,
    payments: 0,
    legacyStatus: 'CANCELLED',
  },
];

function loadMigratedCredits(
  ctx: TenantContext,
  state: SimulationState,
  loadDay: string,
  at: Date,
): void {
  MIGRATIONS.forEach((draft, i) => {
    const borrower = newBorrower(ctx, state, draft.zoneKey, draft.profile, at);
    const plan = ctx.plan(draft.planKey);
    const startDate = addDays(loadDay, draft.startOffset);
    const credit = registerMigratedCredit(ctx, {
      borrower,
      principalMinor: draft.principal,
      plan,
      startDate,
      legacyReference: `LEG-2026-${String(4101 + i)}`,
      payments: historicalPayments(ctx, plan, draft, startDate, loadDay),
      loadedAt: new Date(at.getTime() + i * 60_000),
      loadedBy: ctx.admin,
    });
    // Estado heredado del sistema anterior (castigado / anulado): la carga lo conserva tal cual.
    if (draft.legacyStatus) credit.row.status = draft.legacyStatus;
    if (draft.profile === 'DEFAULTER') credit.stopsPayingOn = startDate;
  });
}

function historicalPayments(
  ctx: TenantContext,
  plan: { installmentsCount: number; interestPct: number; frequency: string },
  draft: MigrationDraft,
  startDate: string,
  loadDay: string,
): HistoricalPayment[] {
  const total = Math.floor(
    (draft.principal * (1000 + plan.interestPct)) / 1000,
  );
  const installment = Math.floor(total / plan.installmentsCount);
  const step = plan.frequency === 'WEEKLY' ? 7 : 1;
  const out: HistoricalPayment[] = [];
  for (let k = 1; k <= draft.payments; k++) {
    const paidOn = addDays(startDate, k * step);
    if (paidOn >= loadDay) break;
    const last = k === plan.installmentsCount;
    out.push({
      paidOn,
      amountMinor: last
        ? total - installment * (plan.installmentsCount - 1)
        : installment,
    });
  }
  return out;
}

function newBorrower(
  ctx: TenantContext,
  state: SimulationState,
  zoneKey: string,
  profile: PayerProfile,
  at: Date,
  creditLimitMinor?: number,
): BorrowerState {
  const spec = ctx.scenario.collectors.find(
    (c) => c.zoneKey === zoneKey && state.isActive(c),
  );
  const collector = spec ? ctx.user(spec.userKey) : null;
  const borrower = createBorrower(ctx, {
    zone: ctx.zone(zoneKey),
    collector,
    profile,
    at,
    creditLimitMinor,
  });
  if (collector) state.collectorOf.set(borrower.id, collector);
  return borrower;
}

// ── Otorgamientos especiales: interés personalizado, crédito paralelo y cupo al tope ────────

function customInterestCredit(
  ctx: TenantContext,
  state: SimulationState,
  at: Date,
): void {
  const borrower = newBorrower(
    ctx,
    state,
    firstZoneKey(ctx),
    'PUNCTUAL',
    at,
    0,
  );
  borrower.row.color = 'GREEN';
  const box = officeFor(ctx, borrower);
  ensureFunds(ctx, {
    box,
    amountMinor: minor(1500),
    treasury: treasuryBox(ctx),
    actor: ctx.admin,
    at,
  });
  grantCredit(ctx, {
    borrower,
    principalMinor: ctx.scenario.principalOptions[5] ?? minor(1500),
    plan: null,
    customTerms: { interestPct: 150, installments: 15, frequency: 'DAILY' },
    fundingBox: box,
    grantedBy: ctx.admin,
    at,
  });
  ctx.audit({
    at,
    actorId: ctx.admin.id,
    action: 'POST /credits',
    entity: 'credits',
    entityId: borrower.id,
    payload: {
      paymentPlanId: null,
      interestPct: 150,
      note: 'Interés personalizado (excepción del ADMIN)',
    },
  });
}

/** Cliente sin tope de cupo con DOS créditos vigentes a la vez. */
function parallelCredit(ctx: TenantContext, at: Date): void {
  const borrower = ctx.borrowers.find(
    (b) =>
      b.row.creditLimitMinor === 0 &&
      ctx.credits.some(
        (c) =>
          c.borrower.id === b.id &&
          c.row.status === 'ACTIVE' &&
          balanceOf(c) > 0,
      ),
  );
  if (!borrower) return;
  const box = officeFor(ctx, borrower);
  ensureFunds(ctx, {
    box,
    amountMinor: minor(500),
    treasury: treasuryBox(ctx),
    actor: ctx.admin,
    at,
  });
  grantCredit(ctx, {
    borrower,
    principalMinor: ctx.scenario.principalOptions[1]!,
    plan: defaultPlan(ctx),
    fundingBox: box,
    grantedBy: ctx.coordinatorFor(borrower.zone),
    at,
  });
}

/** Cliente con cupo bajo y un crédito por todo el cupo: un nuevo otorgamiento choca con OVER_LIMIT. */
function creditAtLimit(
  ctx: TenantContext,
  state: SimulationState,
  at: Date,
): void {
  const limit = ctx.scenario.principalOptions[1]!;
  const borrower = newBorrower(
    ctx,
    state,
    secondZoneKey(ctx),
    'PUNCTUAL',
    at,
    limit,
  );
  const box = officeFor(ctx, borrower);
  ensureFunds(ctx, {
    box,
    amountMinor: limit,
    treasury: treasuryBox(ctx),
    actor: ctx.admin,
    at,
  });
  grantCredit(ctx, {
    borrower,
    principalMinor: limit,
    plan: defaultPlan(ctx),
    fundingBox: box,
    grantedBy: ctx.coordinatorFor(borrower.zone),
    at: after(at, 60),
  });
}

function blockDefaulter(ctx: TenantContext, at: Date): void {
  const credit = ctx.credits.find(
    (c) =>
      c.borrower.profile === 'DEFAULTER' &&
      c.row.status === 'ACTIVE' &&
      c.row.origin === 'ORIGINATED',
  );
  if (!credit) return;
  const coordinator = ctx.coordinatorFor(credit.zone);
  Object.assign(credit.borrower.row, {
    creditBlocked: true,
    color: 'RED',
    updatedAt: at,
  });
  ctx.batch.insert(schema.borrowerNote, {
    tenantId: ctx.tenantId,
    borrowerId: credit.borrower.id,
    authorId: coordinator.id,
    body: 'Cliente bloqueado para nuevos créditos por mora reiterada',
    createdAt: at,
  });
  ctx.audit({
    at,
    actorId: coordinator.id,
    action: 'PATCH /borrowers/:id',
    entity: 'borrowers',
    entityId: credit.borrower.id,
    payload: { creditBlocked: true },
  });
}

/** Clientes registrados sin créditos ("Posición de clientes → sin préstamos"). */
function prospects(ctx: TenantContext, at: Date): void {
  const zones = [...ctx.zones.values()].filter(
    (z) =>
      z.city &&
      ctx.scenario.collectors.some((c) => ctx.zone(c.zoneKey).id === z.id),
  );
  zones.slice(0, 3).forEach((zone, i) => {
    createBorrower(ctx, {
      zone,
      collector: null,
      profile: 'PUNCTUAL',
      at: after(at, i * 60),
      withoutLocation: i === 1,
    });
  });
}

// ── Desenlaces raros de un comprobante PIX ──────────────────────────────────────────────────

function planPixShowcase(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  ago: number,
): void {
  const inter = ctx.accounts.get('inter');
  const picpay = ctx.accounts.get('picpay');
  if (!inter || !picpay) return;
  const pick = (offset: number) => pixCredit(ctx, state, offset);
  switch (ago) {
    case 14:
      plan.add(10, 10, async (at) => {
        const credit = pick(0);
        if (credit)
          await pixVerifiedOnline(ctx, {
            credit,
            amountMinor: balanceOf(credit) + minor(5),
            account: inter,
            at,
          });
      });
      break;
    case 11:
      plan.add(10, 15, async (at) => {
        const original = state.receipts.find(
          (r) => r.payment.storageKey && r.payment.status === 'VERIFIED',
        );
        const credit = pick(1);
        if (original && credit)
          await pixRejectedDuplicate(ctx, {
            credit,
            original,
            account: picpay,
            at,
          });
      });
      break;
    case 9:
      plan.add(10, 25, async (at) => {
        const receipt = await falsePositiveFraud(ctx, state, pick(2), at);
        if (receipt)
          plan.add(17, 30, (verifyAt) =>
            manualVerify(ctx, {
              receipt,
              decidedBy: ctx.admin,
              reason:
                'Validado con el extracto del banco: el pago sí entró a la cuenta',
              at: verifyAt,
              reserved: null,
            }),
          );
      });
      break;
    case 8:
      plan.add(10, 0, async (at, timeline) => {
        const credit = pick(3);
        if (!credit) return;
        await pixUnreadable(ctx, { credit, account: inter, at });
        await pixVerifiedOnline(ctx, {
          credit,
          amountMinor: Math.min(
            balanceOf(credit),
            nextInstallmentMinor(credit),
          ),
          account: inter,
          at: timeline.at(10, 20),
        });
      });
      break;
    case 7:
      plan.add(10, 30, async (at) => {
        const credit = pick(4);
        if (!credit) return;
        const amount = Math.min(
          balanceOf(credit),
          nextInstallmentMinor(credit),
        );
        await pixVerifiedOnline(ctx, {
          credit,
          amountMinor: amount,
          extractedMinor: amount + minor(5),
          account: inter,
          at,
        });
      });
      break;
    case 6:
      plan.add(11, 0, (at) => {
        const original = [...state.receipts]
          .reverse()
          .find((r) => r.payment.status === 'VERIFIED' && r.payment.endToEndId);
        if (original) pixDuplicateIgnored(ctx, original, at);
      });
      break;
    case 5:
    case 2:
      plan.add(10, 40, async (at) => {
        const credit = pick(ago === 5 ? 5 : 6);
        if (!credit) return;
        state.receipts.push(
          await pixToUnknownKey(ctx, {
            credit,
            amountMinor: Math.min(
              balanceOf(credit),
              nextInstallmentMinor(credit),
            ),
            account: inter,
            at,
          }),
        );
      });
      break;
    case 3:
      plan.add(10, 0, (at) => reclassifyTransit(ctx, at));
      break;
    case 4:
      plan.add(10, 50, async (at, timeline) => {
        const credit = pick(7);
        if (!credit) return;
        const amount = Math.min(
          balanceOf(credit),
          nextInstallmentMinor(credit),
        );
        await pixPendingBank(ctx, {
          credit,
          amountMinor: amount,
          account: inter,
          at,
          unavailable: true,
          reconciliationAttempts: 2,
          lastReconciliationAt: timeline.at(18, 0),
        });
        state.addPendingPix(credit.id, amount);
      });
      break;
    case 1:
      plan.add(19, 0, async (at) => {
        const credit = pick(0) ?? ctx.credits[0];
        if (credit)
          await pixOrphan(ctx, {
            credit,
            phone: testPhone(credit.zone.city!, 9000 + ctx.nextPhoneSequence()),
            at,
          });
      });
      break;
  }
  if (ago >= 1 && ago <= 6)
    plan.add(9, 30, (_at, timeline) =>
      chargeFlow(ctx, state, plan, ago, timeline),
    );
  if (ago === 0) {
    plan.add(9, 30, (_at, timeline) =>
      chargeFlow(ctx, state, plan, 0, timeline),
    );
    plan.add(9, 35, (_at, timeline) =>
      chargeFlow(ctx, state, plan, -1, timeline),
    );
  }
}

/** Créditos de clientes que pagan por PIX (activos, con saldo y sin PIX pendiente), estables. */
function pixCredit(
  ctx: TenantContext,
  state: SimulationState,
  offset: number,
): CreditState | null {
  const candidates = ctx.credits.filter(
    (c) =>
      (c.borrower.profile === 'PIX' || c.borrower.profile === 'SETTLER') &&
      c.row.status === 'ACTIVE' &&
      balanceOf(c) > nextInstallmentMinor(c) &&
      !(state.pendingPix.get(c.id) ?? 0),
  );
  return candidates.length ? candidates[offset % candidates.length]! : null;
}

/** Marcado como fraude por el antifraude, pero legítimo: el ADMIN lo valida con el extracto. */
async function falsePositiveFraud(
  ctx: TenantContext,
  state: SimulationState,
  credit: CreditState | null,
  at: Date,
): Promise<Receipt | null> {
  if (!credit) return null;
  const amount = Math.min(balanceOf(credit), nextInstallmentMinor(credit));
  const receipt = await receiveReceipt(ctx, {
    credit,
    amountMinor: amount,
    receiverPixKey: ctx.account('inter').pixKey,
    at,
  });
  const reason =
    'El nombre del recebedor del comprobante no coincide con la cuenta de la empresa';
  Object.assign(receipt.payment, {
    status: 'REJECTED_FRAUD',
    bankStatus: 'NOT_FOUND',
    bankResponse: { provider: 'INTER', status: 'not_found' },
  });
  ctx.batch.insert(schema.fraudAssessment, {
    tenantId: ctx.tenantId,
    paymentId: receipt.payment.id,
    phase: 'PHASE1_SCREEN',
    status: 'rejected',
    score: 100,
    reasons: [reason],
    createdAt: at,
  });
  ctx.batch.insert(schema.paymentEvent, {
    tenantId: ctx.tenantId,
    paymentId: receipt.payment.id,
    creditId: credit.id,
    type: 'payment_rejected_fraud',
    payload: { creditId: credit.id, reasons: [reason] },
    createdAt: after(at, 1),
  });
  chatOut(ctx, {
    phone: credit.borrower.phone,
    channelId: receipt.channelId,
    body: ctx.messages.receipt.underReview,
    at: after(at, 4),
  });
  state.receipts.push(receipt);
  return receipt;
}

/** El ADMIN reclasifica un fondo no identificado: Tránsito → Tesorería. */
function reclassifyTransit(ctx: TenantContext, at: Date): void {
  const transit = ctx.boxes.get('transit');
  if (!transit || transit.balance <= 0) return;
  const pending = (ctx.ledger.history.get(transit.id) ?? []).find(
    (m) => m.direction === 'IN',
  );
  if (!pending) return;
  ctx.ledger.transfer({
    from: transit,
    to: treasuryBox(ctx),
    amountMinor: Math.min(pending.amountMinor, transit.balance),
    reason: 'Reclasificación: PIX identificado de un cliente (llave antigua)',
    at,
    createdBy: ctx.admin.id,
  });
}

// ── Cobro conversacional PicPay (cobrança con copia e cola) ─────────────────────────────────

type ChargeOutcome =
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELED'
  | 'FAILED'
  | 'PENDING'
  | 'AWAITING_SELECTION';

const CHARGE_BY_DAYS_AGO: Readonly<Record<number, ChargeOutcome>> = {
  6: 'PAID',
  5: 'EXPIRED',
  4: 'CANCELED',
  3: 'FAILED',
  2: 'PAID',
  1: 'EXPIRED',
  0: 'PENDING',
  [-1]: 'AWAITING_SELECTION',
};

const CHARGE_TTL_MINUTES = 30;

function chargeFlow(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  key: number,
  timeline: DayTimeline,
): void {
  const outcome = CHARGE_BY_DAYS_AGO[key];
  const credit = pixCredit(ctx, state, 8 + Math.abs(key));
  const picpay = ctx.accounts.get('picpay');
  if (!outcome || !credit || !picpay) return;
  const channelId = ctx.channelFor(credit.zone);
  const phone = credit.borrower.phone;
  const start = timeline.at(9, 30);
  const installment = Math.min(balanceOf(credit), nextInstallmentMinor(credit));
  const overdue = credit.installments
    .filter((i) => i.dueDate < timeline.date)
    .reduce((a, i) => a + (i.amountDueMinor - i.paidMinor), 0);
  chatIn(ctx, {
    phone,
    channelId,
    kind: 'text',
    body: 'Quero pagar',
    at: start,
  });
  chatOut(ctx, {
    phone,
    channelId,
    body: ctx.messages.charge.paymentOptions({
      firstName: credit.borrower.row.firstName,
      installment: formatMoneyMinor(installment, ctx.currency),
      overdue:
        overdue > installment ? formatMoneyMinor(overdue, ctx.currency) : null,
    }),
    at: after(start, 3),
  });
  const row: Row<typeof schema.paymentCharge> = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    creditId: credit.id,
    paymentId: null,
    phone,
    channelId,
    provider: 'PICPAY',
    merchantChargeId: null,
    amountMinor: null,
    installmentMinor: installment,
    overdueMinor: overdue > installment ? overdue : null,
    currency: ctx.currency,
    copyPaste: null,
    status: 'AWAITING_SELECTION',
    expiresAt: null,
    createdAt: start,
    updatedAt: start,
  };
  ctx.batch.track(schema.paymentCharge, row);
  if (outcome === 'AWAITING_SELECTION') return;
  const chosenAt = timeline.at(9, 32);
  chatIn(ctx, { phone, channelId, kind: 'text', body: '1', at: chosenAt });
  if (outcome === 'FAILED') {
    Object.assign(row, {
      status: 'FAILED',
      amountMinor: installment,
      updatedAt: chosenAt,
    });
    chatOut(ctx, {
      phone,
      channelId,
      body: ctx.messages.charge.creationFailed,
      at: after(chosenAt, 4),
    });
    return;
  }
  const merchantChargeId = `preztia-${row.id.slice(0, 8)}`;
  const claim = {
    ...paymentRow(ctx, {
      id: randomUUID(),
      creditId: credit.id,
      amountMinor: installment,
      paidAt: null,
      createdAt: chosenAt,
      status: 'UNVERIFIED',
      payerPhone: phone,
    }),
    channelId,
    txid: merchantChargeId,
  };
  ctx.batch.track(schema.payment, claim);
  ctx.batch.insert(schema.paymentEvent, {
    tenantId: ctx.tenantId,
    paymentId: claim.id,
    creditId: credit.id,
    type: 'payment_charge_created',
    payload: { merchantChargeId, amountMinor: installment },
    createdAt: chosenAt,
  });
  const copyPaste = `00020126580014BR.GOV.BCB.PIX0136${picpay.pixKey ?? ''}5204000053039865406${(installment / 100).toFixed(2)}5802BR5925PREZTIA6009SAO PAULO62070503***6304${ctx.random.hex(4).toUpperCase()}`;
  Object.assign(row, {
    status: 'PENDING',
    amountMinor: installment,
    merchantChargeId,
    copyPaste,
    paymentId: claim.id,
    expiresAt: new Date(chosenAt.getTime() + CHARGE_TTL_MINUTES * 60_000),
    updatedAt: chosenAt,
  });
  chatOut(ctx, {
    phone,
    channelId,
    body: ctx.messages.charge.chargeInstructions({
      amount: formatMoneyMinor(installment, ctx.currency),
      copyPasteCode: copyPaste,
      expiresInMinutes: CHARGE_TTL_MINUTES,
    }),
    at: after(chosenAt, 4),
  });
  if (outcome === 'PENDING') return;
  const settledAt = timeline.at(9, 50);
  if (outcome === 'EXPIRED' || outcome === 'CANCELED') {
    picpayWebhookStatus(ctx, {
      account: picpay,
      merchantChargeId,
      status: outcome,
      at: settledAt,
    });
    Object.assign(row, { status: outcome, updatedAt: settledAt });
    return;
  }
  const receipt: Receipt = {
    payment: claim,
    credit,
    endToEndId: `E${credit.borrower.payerBank.ispb}${settledAt.toISOString().replace(/[-:T]/g, '').slice(0, 12)}${ctx.random.alphanumeric(11)}`,
    channelId,
  };
  const incoming = picpayWebhookPaid(ctx, {
    account: picpay,
    amountMinor: installment,
    endToEndId: receipt.endToEndId,
    merchantChargeId,
    at: settledAt,
  });
  Object.assign(row, { status: 'PAID', updatedAt: settledAt });
  reserveForReview(ctx, receipt, incoming, after(settledAt, 1));
  plan.add(11, 0, (at) =>
    manualVerify(ctx, {
      receipt,
      decidedBy: ctx.coordinatorFor(credit.zone),
      reason: 'Cobrança PicPay paga: crédito real conciliado',
      at,
      reserved: incoming,
    }),
  );
}

// ── Fechas de pago atrasadas (captura sin señal) ────────────────────────────────────────────

function planOfflineCaptures(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  const spec = ctx.scenario.collectors.find((c) => state.isActive(c));
  if (!spec) return;
  const collector = ctx.user(spec.userKey);
  const credits = ctx.credits.filter(
    (c) =>
      c.row.status === 'ACTIVE' &&
      !c.stopsPayingOn &&
      state.collectorOf.get(c.borrower.id)?.id === collector.id &&
      balanceOf(c) > nextInstallmentMinor(c) * 2 &&
      c.row.startDate < addDays(date, -7),
  );
  const [inWindow, tooOld] = credits;
  plan.add(8, 20, (at) => {
    if (inWindow) {
      registerCashPayment(ctx, {
        credit: inWindow,
        amountMinor: nextInstallmentMinor(inWindow),
        receivedBy: collector,
        at,
        idempotencyKey: randomUUID(),
        requestedDate: {
          kind: 'OFFLINE_CAPTURE',
          capturedAt: ctx.clock.at(addDays(date, -1), 18, 10),
        },
      });
    }
    if (tooOld) {
      registerCashPayment(ctx, {
        credit: tooOld,
        amountMinor: nextInstallmentMinor(tooOld),
        receivedBy: collector,
        at: after(at, 120),
        idempotencyKey: randomUUID(),
        requestedDate: {
          kind: 'OFFLINE_CAPTURE',
          capturedAt: ctx.clock.at(addDays(date, -6), 17, 0),
        },
      });
    }
  });
}

// ── Pagos recibidos en la oficina (quien registra no tiene caja de ruta) ───────────────────

const WEDNESDAY = 3;

/**
 * El cliente pagó en la oficina: el ADMIN lo registra con la fecha en que pagó (ayer) o el
 * coordinador de la zona lo registra hoy. El dinero entra a la caja de oficina de la zona, no a la
 * caja de ruta de un cobrador (no entra en su rendición ni en su comisión).
 */
function officePayment(
  ctx: TenantContext,
  state: SimulationState,
  input: { at: Date; paidOn: string | null; by: UserRef | null },
): void {
  const credit = ctx.credits.find(
    (c) =>
      c.row.status === 'ACTIVE' &&
      !c.stopsPayingOn &&
      !state.routedToday.has(c.id) &&
      !(state.pendingPix.get(c.id) ?? 0) &&
      balanceOf(c) > nextInstallmentMinor(c),
  );
  if (!credit) return;
  registerCashPayment(ctx, {
    credit,
    amountMinor: nextInstallmentMinor(credit),
    receivedBy: input.by ?? ctx.coordinatorFor(credit.zone),
    receivingBox: officeFor(ctx, credit.borrower),
    at: input.at,
    idempotencyKey: randomUUID(),
    ...(input.paidOn
      ? { requestedDate: { kind: 'MANUAL' as const, paidOn: input.paidOn } }
      : {}),
  });
}

// ── Telegram, listas, solicitudes de cambio, notas y recordatorios ──────────────────────────

function telegramLinks(ctx: TenantContext, at: Date): void {
  const channelId = ctx.telegramChannel;
  if (!channelId) return;
  const zonePath = ctx.zonePathByChannel.get(channelId);
  const borrowers = ctx.borrowers
    .filter((b) => b.zone.path === zonePath)
    .slice(0, 4);
  borrowers.forEach((borrower, i) => {
    const linkAt = after(at, i * 120);
    ctx.batch.insert(schema.telegramChatLink, {
      tenantId: ctx.tenantId,
      channelId,
      chatId: ctx.random.digits(10),
      phone: borrower.phone,
      verifiedAt: linkAt,
      blockedAt: i === 3 ? after(linkAt, 3600) : null,
      createdAt: linkAt,
      updatedAt: linkAt,
    });
    chatIn(ctx, {
      phone: borrower.phone,
      channelId,
      kind: 'text',
      body: 'Olá, quero ver meu saldo',
      at: after(linkAt, 10),
    });
    chatOut(ctx, {
      phone: borrower.phone,
      channelId,
      body: ctx.messages.telegram.identified,
      at: after(linkAt, 12),
    });
  });
  // Chat que nunca compartió su contacto: el bot no sabe quién es.
  ctx.batch.insert(schema.telegramChatLink, {
    tenantId: ctx.tenantId,
    channelId,
    chatId: ctx.random.digits(10),
    phone: null,
    verifiedAt: null,
    blockedAt: null,
    createdAt: at,
    updatedAt: at,
  });
}

function borrowerLists(ctx: TenantContext, at: Date): void {
  const groups: ReadonlyArray<{ name: string; members: BorrowerState[] }> = [
    {
      name: 'Clientes VIP',
      members: ctx.borrowers.filter((b) => b.row.color === 'GREEN'),
    },
    {
      name: 'Recuperación de cartera',
      members: ctx.borrowers.filter((b) => b.profile === 'DEFAULTER'),
    },
    {
      name: 'Renovaciones del mes',
      members: ctx.borrowers.filter((b) =>
        ctx.credits.some(
          (c) => c.borrower.id === b.id && c.row.status === 'SETTLED',
        ),
      ),
    },
    { name: 'Lista vacía (nueva campaña)', members: [] },
  ];
  for (const group of groups) {
    const listId = randomUUID();
    ctx.batch.insert(schema.borrowerList, {
      id: listId,
      tenantId: ctx.tenantId,
      name: group.name,
      createdAt: at,
    });
    for (const member of group.members.slice(0, 12)) {
      ctx.batch.insert(schema.borrowerListMember, {
        tenantId: ctx.tenantId,
        listId,
        borrowerId: member.id,
        createdAt: at,
      });
    }
  }
}

function changeRequest(
  ctx: TenantContext,
  state: SimulationState,
  ago: number,
  at: Date,
): void {
  const borrower = ctx.borrowers.filter((b) => state.collectorOf.get(b.id))[
    ago % 7
  ];
  if (!borrower) return;
  const collector = state.collectorOf.get(borrower.id)!;
  const reviewer = ctx.coordinatorFor(borrower.zone);
  const status = ago === 15 ? 'APPROVED' : ago === 9 ? 'REJECTED' : 'PENDING';
  const changes =
    ago === 4
      ? { phone: borrower.phone.replace(/\d{4}$/, '9999') }
      : { business: `${borrower.row.business} (nueva sede)` };
  ctx.batch.track(schema.changeRequest, {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    borrowerId: borrower.id,
    requestedBy: collector.id,
    changes,
    status,
    reviewedBy: status === 'PENDING' ? null : reviewer.id,
    reviewedAt: status === 'PENDING' ? null : after(at, 1800),
    createdAt: at,
  });
  if (status === 'APPROVED')
    Object.assign(borrower.row, {
      business: changes.business,
      updatedAt: after(at, 1800),
    });
}

function borrowerNotes(ctx: TenantContext, at: Date): void {
  const notes = [
    'Prefiere que lo visiten después de las 3 p. m.',
    'Tiene un segundo local en el mercado municipal',
    'Referido por otro cliente al día; buen historial',
  ];
  ctx.borrowers
    .filter((b) => b.profile === 'DEFAULTER' || b.row.color === 'GREEN')
    .slice(0, 3)
    .forEach((b, i) => {
      ctx.batch.insert(schema.borrowerNote, {
        tenantId: ctx.tenantId,
        borrowerId: b.id,
        authorId: ctx.coordinatorFor(b.zone).id,
        body: notes[i % notes.length]!,
        createdAt: after(at, i * 60),
      });
    });
}

/** Recordatorio de cobro enviado a mano desde Cartera (un envío por crédito y día). */
function manualReminders(
  ctx: TenantContext,
  state: SimulationState,
  at: Date,
): void {
  const pixKey =
    ctx.scenario.reminder.pixKey ?? ctx.accounts.get('picpay')?.pixKey;
  if (!pixKey) return;
  const date = at.toISOString().slice(0, 10);
  ctx.credits
    .filter(
      (c) =>
        c.row.status === 'ACTIVE' &&
        overdueCount(c, date) > 0 &&
        !(state.pendingPix.get(c.id) ?? 0),
    )
    .slice(0, 2)
    .forEach((credit, i) => {
      const sentAt = after(at, i * 30);
      const due = credit.installments
        .filter((x) => x.dueDate <= date)
        .reduce((a, x) => a + (x.amountDueMinor - x.paidMinor), 0);
      if (due <= 0) return;
      const actor = ctx.coordinatorFor(credit.zone);
      chatOut(ctx, {
        phone: credit.borrower.phone,
        channelId: ctx.channelFor(credit.zone),
        body: buildCollectionReminderMessage(
          {
            firstName: credit.borrower.row.firstName,
            dueMinor: due,
            currency: ctx.currency,
            pixKey,
          },
          ctx.scenario.language,
        ),
        at: sentAt,
      });
      ctx.batch.insert(schema.idempotencyKey, {
        tenantId: ctx.tenantId,
        key: `collection-reminder:${credit.id}:${date}`,
        method: 'CRON',
        path: '/collections/collection-reminder',
        status: 200,
        response: null,
        createdAt: sentAt,
      });
      ctx.audit({
        at: sentAt,
        actorId: actor.id,
        action: 'SEND collection-reminder',
        entity: 'collection-reminder',
        entityId: credit.id,
        payload: { trigger: 'MANUAL', dueMinor: due, currency: ctx.currency },
      });
    });
}

/** Recorrido GPS de los cobradores activos (un punto cada ~20 minutos en horario de ruta). */
function collectorTracks(
  ctx: TenantContext,
  state: SimulationState,
  date: string,
): void {
  for (const spec of ctx.scenario.collectors.filter((c) => state.isActive(c))) {
    const city = ctx.zone(spec.zoneKey).city;
    if (!city) continue;
    const collector = ctx.user(spec.userKey);
    for (let step = 0; step < 28; step++) {
      const recordedAt = ctx.clock.instant(
        date,
        8 + Math.floor((step * 20) / 60),
        (step * 20) % 60,
      );
      const point = jitterLocation(ctx.random, city);
      ctx.batch.insert(schema.collectorLocation, {
        tenantId: ctx.tenantId,
        collectorId: collector.id,
        lat: point.lat,
        lng: point.lng,
        recordedAt,
        createdAt: recordedAt,
      });
    }
  }
}

/** Arqueo de la caja menor con descuadre que aún NO se ajusta (queda el botón "Ajustar"). */
function pendingPettyCount(ctx: TenantContext, at: Date): void {
  const petty = ctx.boxes.get('petty');
  if (petty && petty.balance > minor(10))
    weeklyCount(ctx, {
      box: petty,
      performedBy: ctx.admin,
      at,
      differenceMinor: -minor(8),
      notes: 'Faltan R$ 8: posible vuelto mal entregado; pendiente de revisar',
    });
}

// ── utilidades ──────────────────────────────────────────────────────────────────────────────

function firstZoneKey(ctx: TenantContext): string {
  return ctx.scenario.collectors[0]!.zoneKey;
}

function secondZoneKey(ctx: TenantContext): string {
  return (ctx.scenario.collectors[1] ?? ctx.scenario.collectors[0]!).zoneKey;
}

function officeFor(ctx: TenantContext, borrower: BorrowerState) {
  const spec = ctx.scenario.collectors.find(
    (c) =>
      c.zoneKey ===
      [...ctx.zones.entries()].find(([, z]) => z.id === borrower.zone.id)?.[0],
  );
  return ctx.box(
    spec?.officeBoxKey ?? ctx.scenario.collectors[0]!.officeBoxKey,
  );
}

function defaultPlan(ctx: TenantContext) {
  return ctx.plan(ctx.scenario.plans.find((p) => p.isDefault)!.key);
}
