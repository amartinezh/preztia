import { Injectable } from '@nestjs/common';
import {
  clientMessagesFor,
  type PaymentPlan,
  type PlanMessages,
} from '@preztiaos/domain';
import type {
  PlanOfferNotifier,
  ScheduledInstallment,
} from '@preztiaos/application';
import { ProactiveTextSender } from '../../messaging/proactive-text-sender';
import { ClientLanguageRepository } from '../../tenant-config/client-language.repository';

/**
 * Adaptador del puerto `PlanOfferNotifier`: formatea la oferta (menú de planes / cronograma) y la
 * envía por el canal del cliente (WhatsApp o Telegram) con el router de mensajería (sin nuevo
 * cliente HTTP). La presentación (texto del mensaje) es responsabilidad de infraestructura; la
 * redacción sale del diccionario del idioma del tenant (resuelto por el canal en cada envío).
 */
@Injectable()
export class PlanOfferMessagingNotifier implements PlanOfferNotifier {
  // Envío proactivo: el aviso sale por el canal ALCANZABLE hoy (WhatsApp o Telegram), partiendo del
  // guardado en la solicitud (ADR #40, D8).
  constructor(
    private readonly sender: ProactiveTextSender,
    private readonly languages: ClientLanguageRepository,
  ) {}

  async sendPlanMenu(input: {
    channelId: string;
    recipient: string;
    plans: readonly PaymentPlan[];
  }): Promise<void> {
    const m = await this.messagesFor(input.channelId);
    await this.send(
      input.channelId,
      input.recipient,
      m.menu(planLines(m, input.plans)),
    );
  }

  async sendScheduleForAcceptance(input: {
    channelId: string;
    recipient: string;
    plan: PaymentPlan;
    principalMinor: number;
    currency: string;
    schedule: readonly ScheduledInstallment[];
  }): Promise<void> {
    const m = await this.messagesFor(input.channelId);
    const rows = input.schedule.map(
      (i) => `${i.dueDate} — ${formatMoney(i.amountDueMinor, input.currency)}`,
    );
    const total = input.schedule.reduce((acc, i) => acc + i.amountDueMinor, 0);
    const body = m.offer({
      principal: formatMoney(input.principalMinor, input.currency),
      planName: input.plan.name,
      scheduleRows: rows,
      total: formatMoney(total, input.currency),
      installments: input.plan.installmentsCount,
      frequency: m.frequency[input.plan.frequency],
    });
    await this.send(input.channelId, input.recipient, body);
  }

  async sendSelectionReask(input: {
    channelId: string;
    recipient: string;
    plans: readonly PaymentPlan[];
  }): Promise<void> {
    const m = await this.messagesFor(input.channelId);
    await this.send(
      input.channelId,
      input.recipient,
      m.selectionReask(planLines(m, input.plans)),
    );
  }

  async sendAcceptanceReask(input: {
    channelId: string;
    recipient: string;
  }): Promise<void> {
    const m = await this.messagesFor(input.channelId);
    await this.send(input.channelId, input.recipient, m.acceptanceReask);
  }

  async sendAcknowledgement(input: {
    channelId: string;
    recipient: string;
    decision: 'ACCEPT' | 'DECLINE';
  }): Promise<void> {
    const m = await this.messagesFor(input.channelId);
    const body = input.decision === 'ACCEPT' ? m.accepted : m.declined;
    await this.send(input.channelId, input.recipient, body);
  }

  async sendOfferExpired(input: {
    channelId: string;
    recipient: string;
  }): Promise<void> {
    const m = await this.messagesFor(input.channelId);
    await this.send(input.channelId, input.recipient, m.expired);
  }

  /** Textos de la negociación en el idioma vigente del tenant del canal. */
  private async messagesFor(channelId: string): Promise<PlanMessages> {
    return clientMessagesFor(await this.languages.byChannel(channelId)).plan;
  }

  private async send(
    channelId: string,
    recipient: string,
    body: string,
  ): Promise<void> {
    await this.sender.sendText({ channelId, recipient }, body);
  }
}

/** Opciones numeradas del menú: "1) Plan 20 días — 20 cuotas diario · 20%". */
function planLines(m: PlanMessages, plans: readonly PaymentPlan[]): string[] {
  return plans.map(
    (plan, idx) =>
      `${idx + 1}) ${m.planLine({
        name: plan.name,
        installments: plan.installmentsCount,
        frequency: m.frequency[plan.frequency],
        // El interés viaja en base-mil (200 = 20 %).
        interestPct: plan.interestPct / 10,
      })}`,
  );
}

/** Formatea unidades menores como moneda legible: 500000 → "COP 5.000". */
function formatMoney(amountMinor: number, currency: string): string {
  const major = Math.round(amountMinor / 100);
  return `${currency} ${major.toLocaleString('es-CO')}`;
}
