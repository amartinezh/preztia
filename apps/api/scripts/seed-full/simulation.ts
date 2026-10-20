import {
  addDays,
  nextPeriodToClose,
  settlementSettingsOf,
} from '@preztiaos/domain';
import { planApplications } from './applications-plan';
import { eachDay } from './clock';
import type { TenantContext } from './context';
import { DayPlan } from './day-plan';
import {
  planCollections,
  planDebtClosures,
  planDeposits,
  planExpenses,
  planGrants,
  planPettyExpenses,
  planPicpayReviews,
  planRemittances,
  planRoutes,
  planTreasury,
  planVisits,
  type FirstCredit,
} from './planners';
import { planShowcase } from './showcase';
import { SimulationState } from './sim-state';
import {
  closeNextPeriod,
  commissionsDue,
  payCommission,
  type ClosedPeriod,
} from './settlements';
import { openBalances } from './treasury';

// MOTOR de la simulación: recorre la historia día por día. Al empezar cada día sella los períodos
// de liquidación ya terminados (con el repositorio real de la API), luego cada planificador agenda
// lo que ocurre ese día y la agenda se ejecuta en orden cronológico; al final el día se persiste.

/** Días entre el corte de un período y el pago de sus comisiones. */
const COMMISSION_PAY_DELAY_DAYS = 2;
/** El segundo período lo cierra el ADMIN a mano dos días tarde (cierre retroactivo). */
const LATE_MANUAL_CLOSE_INDEX = 1;
const LATE_MANUAL_CLOSE_DELAY_DAYS = 2;
/** Último día (antes del final) en que un cobrador que se retira recibe clientes nuevos. */
const RETIREMENT_MARGIN_DAYS = 10;

export async function simulateTenant(
  ctx: TenantContext,
  start: string,
): Promise<SimulationState> {
  const days = eachDay(start, ctx.clock.today);
  const state = new SimulationState(ctx, start, days);
  openBalances(
    ctx,
    ctx.admin,
    ctx.clock.timeline(addDays(start, -1)).at(18, 0),
  );
  await ctx.flush();
  const firsts = firstCreditCalendar(ctx, state);

  for (const date of days) {
    if (date === ctx.clock.today && !ctx.clock.canSimulateToday()) break;
    await closeEndedPeriods(ctx, state, date);
    state.routedToday.clear();
    const plan = new DayPlan();
    planTreasury(ctx, state, plan, date);
    planDebtClosures(ctx, state, plan, date);
    planCommissionPayments(ctx, state, plan, date);
    planShowcase(ctx, state, plan, date);
    planGrants(ctx, state, plan, date, firsts.get(date) ?? []);
    planApplications(ctx, state, plan, date);
    planRoutes(ctx, state, plan, date);
    planCollections(ctx, state, plan, date);
    planPicpayReviews(ctx, state, plan, date);
    planVisits(ctx, state, plan, date);
    planExpenses(ctx, state, plan, date);
    planPettyExpenses(ctx, plan, date);
    planDeposits(ctx, state, plan, date);
    planRemittances(ctx, state, plan, date);
    await plan.execute(ctx.clock.timeline(date));
    await ctx.flush();
  }
  return state;
}

/**
 * Primer crédito de cada cliente de la cartera, repartido a lo largo de la historia: los primeros
 * alcanzan a terminar y renovar; los últimos están recién desembolsados.
 */
function firstCreditCalendar(
  ctx: TenantContext,
  state: SimulationState,
): Map<string, FirstCredit[]> {
  const calendar = new Map<string, FirstCredit[]>();
  const lastUsable = state.days.length - 3;
  for (const collector of ctx.scenario.collectors) {
    const retirement = state.retirementDate(collector);
    const last = retirement
      ? state.days.indexOf(retirement) - RETIREMENT_MARGIN_DAYS
      : lastUsable;
    collector.profiles.forEach((_, profileIndex) => {
      let index = Math.min(
        last,
        Math.floor((profileIndex * last) / collector.profiles.length) +
          ctx.random.int(0, 2),
      );
      if (ctx.clock.isSunday(state.days[index]!)) index += 1;
      const date = state.days[Math.max(0, index)]!;
      calendar.set(date, [
        ...(calendar.get(date) ?? []),
        { collector, profileIndex },
      ]);
    });
  }
  return calendar;
}

/** Sella los períodos terminados al empezar el día (cierre automático del sistema o del ADMIN). */
async function closeEndedPeriods(
  ctx: TenantContext,
  state: SimulationState,
  date: string,
): Promise<void> {
  const settings = settlementSettingsOf(ctx.settings);
  if (!settings.startDate || !settings.autoClose) return;
  for (;;) {
    const next = nextPeriodToClose(settings, {
      lastClosedEnd: state.lastClosedEnd,
      firstActivityDate: null,
    });
    if (!next || next.end > date) return;
    const manual = state.closed.length === LATE_MANUAL_CLOSE_INDEX;
    if (manual && date < addDays(next.end, LATE_MANUAL_CLOSE_DELAY_DAYS))
      return;
    const now = manual ? ctx.clock.at(date, 9) : ctx.clock.at(date, 0, 30);
    if (now > ctx.clock.now) return;
    const period = await closeNextPeriod(ctx, {
      now,
      closedBy: manual ? ctx.admin : null,
    });
    if (!period) return;
    state.closed.push(period);
    state.lastClosedEnd = period.periodEnd;
  }
}

/**
 * Pago de las comisiones causadas, dos días después del corte. La del período más reciente se deja
 * sin pagar a propósito (queda el botón "Pagar comisión").
 */
function planCommissionPayments(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  if (!ctx.scenario.features.commissions || !ctx.settings.commissionsEnabled)
    return;
  const payable = state.closed.filter(
    (p) =>
      addDays(p.periodEnd, COMMISSION_PAY_DELAY_DAYS) === date &&
      addDays(p.periodEnd, 7) <= ctx.clock.today,
  );
  for (const period of payable) payPeriodCommissions(ctx, state, plan, period);
}

function payPeriodCommissions(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  period: ClosedPeriod,
): void {
  for (const due of commissionsDue(period)) {
    const spec = ctx.scenario.collectors.find(
      (c) => ctx.user(c.userKey).id === due.collectorId,
    );
    if (!spec) continue;
    // Un cobrador cobra su comisión de su propio efectivo (al final de la ruta); el resto, en oficina.
    const fromRoute = spec.style === 'SHORT_ONCE' && state.isActive(spec);
    plan.add(fromRoute ? 18 : 10, fromRoute ? 30 : 0, (at) => {
      const route = ctx.box(spec.routeBoxKey);
      const box =
        fromRoute && route.balance >= due.amountMinor
          ? route
          : ctx.box(spec.officeBoxKey);
      if (box.balance < due.amountMinor) return;
      payCommission(ctx, { period, due, box, paidBy: ctx.admin, at });
    });
  }
}
