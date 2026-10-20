import { addDays } from '@preztiaos/domain';
import type { TenantContext } from './context';
import type { DayPlan } from './day-plan';
import {
  runApplication,
  runInquiry,
  type ApplicationSpec,
} from './origination';
import { minor } from './scenario';
import type { SimulationState } from './sim-state';
import { ensureFunds } from './treasury';
import { treasuryBox } from './planners';

// CALENDARIO de solicitudes por chat: cada entrada deja una solicitud en un estado distinto de la
// máquina KYC / negociación / decisión, de modo que la bandeja, la revisión antifraude, los rechazos
// y el panel de tiempos de atención tengan todos sus casos. Los días son relativos a HOY.

type Draft = Omit<
  ApplicationSpec,
  'zone' | 'reviewer' | 'fundingBox' | 'collector'
> & {
  readonly zoneKey: string;
  readonly daysAgo: number;
  readonly hour: number;
};

const MAIN_APPLICATIONS: readonly Draft[] = [
  {
    zoneKey: 'div',
    daysAgo: 60,
    hour: 9,
    docs: 'ALL',
    requestedMinor: minor(1000),
    location: true,
    verdict: 'approved',
    offer: 'ACCEPTED',
    planKey: 'd20',
    principalMinor: minor(1000),
    decision: 'APPROVE',
  },
  {
    zoneKey: 'div',
    daysAgo: 52,
    hour: 10,
    docs: 'ALL',
    requestedMinor: minor(3000),
    location: true,
    verdict: 'rejected',
    visionRisk: 'HIGH',
    decision: 'REJECT',
    rejectionReason:
      'Documento de identidad adulterado (CPF inválido) y foto del local tomada de internet',
  },
  {
    zoneKey: 'bh',
    daysAgo: 45,
    hour: 9,
    docs: 'ALL',
    requestedMinor: minor(800),
    location: true,
    verdict: 'approved',
    offer: 'AWAITING_ACCEPTANCE',
    planKey: 'd24',
    principalMinor: minor(800),
    decision: 'OVERRIDE',
  },
  {
    zoneKey: 'bh',
    daysAgo: 38,
    hour: 11,
    docs: 'ALL',
    requestedMinor: minor(500),
    location: true,
    verdict: 'approved',
    offer: 'ACCEPTED',
    planKey: 'd11',
    principalMinor: minor(500),
    decision: 'APPROVE',
    viaTelegram: true,
  },
  {
    zoneKey: 'spc',
    daysAgo: 30,
    hour: 9,
    docs: 'ALL',
    requestedMinor: minor(2000),
    location: true,
    verdict: 'suspicious',
    reusedDocument: true,
    decision: 'REJECT',
    rejectionReason:
      'Certificado del negocio ya usado en otra solicitud; posible suplantación',
  },
  {
    zoneKey: 'spc',
    daysAgo: 24,
    hour: 10,
    docs: 'ALL',
    requestedMinor: minor(1500),
    location: true,
    verdict: 'approved',
    offer: 'ACCEPTED',
    planKey: 'w8',
    principalMinor: minor(1500),
    decision: 'APPROVE',
  },
  {
    zoneKey: 'cps',
    daysAgo: 20,
    hour: 15,
    docs: 'ONE',
    requestedMinor: minor(400),
    location: false,
  },
  {
    zoneKey: 'cps',
    daysAgo: 15,
    hour: 9,
    docs: 'ALL',
    requestedMinor: minor(1000),
    location: true,
    verdict: 'approved',
    rerun: true,
    visionRisk: 'MEDIUM',
    offer: 'ACCEPTED',
    planKey: 'd20',
    principalMinor: minor(1000),
    decision: 'APPROVE',
  },
  {
    zoneKey: 'div',
    daysAgo: 12,
    hour: 10,
    docs: 'ALL',
    requestedMinor: minor(2000),
    location: true,
    verdict: 'approved',
    offer: 'DECLINED',
    planKey: 'm3',
    principalMinor: minor(2000),
  },
  {
    zoneKey: 'bh',
    daysAgo: 9,
    hour: 16,
    docs: 'ID_HALF',
    requestedMinor: minor(600),
    location: false,
    failure: {
      stage: 'DOCUMENT_INTAKE',
      kind: 'document',
      error: 'Falló la descarga del media de WhatsApp: ECONNRESET',
    },
  },
  {
    zoneKey: 'spc',
    daysAgo: 6,
    hour: 11,
    docs: 'ALL',
    requestedMinor: minor(1200),
    location: true,
    verdict: 'approved',
    offer: 'EXPIRED',
    planKey: 'd20',
    principalMinor: minor(1000),
  },
  {
    zoneKey: 'cps',
    daysAgo: 3,
    hour: 9,
    docs: 'ALL',
    requestedMinor: minor(900),
    location: true,
    verdict: 'suspicious',
    manualReview: true,
    mismatch: true,
  },
  {
    zoneKey: 'div',
    daysAgo: 2,
    hour: 14,
    docs: 'ALL',
    requestedMinor: minor(700),
    location: true,
    verdict: 'approved',
    offer: 'AWAITING_SELECTION',
  },
  {
    zoneKey: 'bh',
    daysAgo: 1,
    hour: 10,
    docs: 'ALL',
    requestedMinor: minor(1000),
    location: true,
    verdict: 'approved',
    offer: 'ACCEPTED',
    planKey: 'd20',
    principalMinor: minor(1000),
  },
  {
    zoneKey: 'div',
    daysAgo: 0,
    hour: 8,
    docs: 'ALL',
    requestedMinor: minor(500),
    location: true,
    verdict: 'approved',
    offer: 'ACCEPTED',
    planKey: 'd11',
    principalMinor: minor(500),
    decision: 'APPROVE',
  },
  {
    zoneKey: 'spc',
    daysAgo: 0,
    hour: 10,
    docs: 'ALL',
    requestedMinor: minor(1500),
    location: true,
    verdict: 'approved',
  },
  {
    zoneKey: 'cps',
    daysAgo: 0,
    hour: 11,
    docs: 'TWO',
    requestedMinor: minor(800),
    location: true,
    mismatch: true,
  },
  {
    zoneKey: 'bh',
    daysAgo: 0,
    hour: 12,
    docs: 'NONE',
    requestedMinor: null,
    location: false,
  },
];

const CO_APPLICATIONS: readonly Draft[] = [
  {
    zoneKey: 'med',
    daysAgo: 40,
    hour: 9,
    docs: 'ALL',
    requestedMinor: minor(500_000),
    location: true,
    verdict: 'approved',
    offer: 'ACCEPTED',
    planKey: 'd20',
    principalMinor: minor(500_000),
    decision: 'APPROVE',
  },
  {
    zoneKey: 'env',
    daysAgo: 21,
    hour: 10,
    docs: 'ALL',
    requestedMinor: minor(2_000_000),
    location: true,
    verdict: 'rejected',
    decision: 'REJECT',
    rejectionReason: 'Cédula con inconsistencias en la fecha de expedición',
  },
  {
    zoneKey: 'med',
    daysAgo: 3,
    hour: 11,
    docs: 'ALL',
    requestedMinor: minor(800_000),
    location: true,
    verdict: 'approved',
    offer: 'AWAITING_SELECTION',
  },
  {
    zoneKey: 'env',
    daysAgo: 0,
    hour: 9,
    docs: 'ONE',
    requestedMinor: minor(300_000),
    location: false,
  },
];

interface InquiryDraft {
  readonly zoneKey: string;
  readonly daysAgo: number;
  readonly hour: number;
  readonly questions: readonly string[];
  readonly offTopic?: boolean;
  readonly failure?: string;
}

const MAIN_INQUIRIES: readonly InquiryDraft[] = [
  {
    zoneKey: 'div',
    daysAgo: 30,
    hour: 18,
    questions: [
      'Quanto fica a parcela de R$ 1.000 em 20 vezes?',
      'E quais documentos vocês pedem?',
    ],
  },
  {
    zoneKey: 'spc',
    daysAgo: 5,
    hour: 20,
    questions: ['Vocês vendem celular?'],
    offTopic: true,
  },
  {
    zoneKey: 'cps',
    daysAgo: 2,
    hour: 9,
    questions: ['Bom dia, qual o juros do plano de 24 parcelas?'],
    failure: 'Cannot read properties of undefined (reading "transcript")',
  },
  {
    zoneKey: 'bh',
    daysAgo: 0,
    hour: 9,
    questions: ['Preciso de documentos para pedir 500 reais?'],
  },
];

const CO_INQUIRIES: readonly InquiryDraft[] = [
  {
    zoneKey: 'med',
    daysAgo: 7,
    hour: 17,
    questions: ['¿Cuánto pago diario por un préstamo de 500 mil a 20 cuotas?'],
  },
];

export function planApplications(
  ctx: TenantContext,
  state: SimulationState,
  plan: DayPlan,
  date: string,
): void {
  if (!ctx.scenario.features.applications) return;
  const main = ctx.scenario.countryCode === 'BR';
  for (const draft of (main ? MAIN_APPLICATIONS : CO_APPLICATIONS).filter((d) =>
    isOn(ctx, d.daysAgo, date),
  )) {
    plan.add(draft.hour, 0, async (_at, timeline) => {
      const zone = ctx.zone(draft.zoneKey);
      const collectorSpec = ctx.scenario.collectors.find(
        (c) => c.zoneKey === draft.zoneKey && state.isActive(c),
      );
      const collector = collectorSpec ? ctx.user(collectorSpec.userKey) : null;
      const fundingBox = collectorSpec
        ? ctx.box(collectorSpec.officeBoxKey)
        : treasuryBox(ctx);
      if (draft.decision === 'APPROVE' || draft.decision === 'OVERRIDE') {
        ensureFunds(ctx, {
          box: fundingBox,
          amountMinor: draft.principalMinor ?? 0,
          treasury: treasuryBox(ctx),
          actor: ctx.admin,
          at: timeline.at(draft.hour, 0),
        });
      }
      const result = await runApplication(
        ctx,
        {
          ...draft,
          zone,
          reviewer: ctx.coordinatorFor(zone),
          fundingBox,
          collector,
        },
        date,
        draft.hour,
      );
      if (result.borrower && collector)
        state.collectorOf.set(result.borrower.id, collector);
    });
  }
  for (const inquiry of (main ? MAIN_INQUIRIES : CO_INQUIRIES).filter((d) =>
    isOn(ctx, d.daysAgo, date),
  )) {
    plan.add(inquiry.hour, 30, (at) =>
      runInquiry(ctx, {
        zone: ctx.zone(inquiry.zoneKey),
        at,
        questions: inquiry.questions,
        offTopic: inquiry.offTopic,
        failure: inquiry.failure,
      }),
    );
  }
}

function isOn(ctx: TenantContext, daysAgo: number, date: string): boolean {
  return addDays(ctx.clock.today, -daysAgo) === date;
}
