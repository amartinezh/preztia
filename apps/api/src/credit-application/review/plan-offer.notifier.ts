import { Injectable } from '@nestjs/common';
import type { PaymentPlan } from '@preztiaos/domain';
import type {
  PlanOfferNotifier,
  ScheduledInstallment,
} from '@preztiaos/application';
import { WhatsappTextSender } from '../../conversations/text/whatsapp-text-sender';

const FREQUENCY_LABEL: Record<PaymentPlan['frequency'], string> = {
  DAILY: 'diario',
  WEEKLY: 'semanal',
  BIWEEKLY: 'quincenal',
  MONTHLY: 'mensual',
};

/**
 * Adaptador del puerto `PlanOfferNotifier`: formatea la oferta (menú de planes / cronograma) y la
 * envía por WhatsApp reusando el `WhatsappTextSender` del contexto de Conversaciones (sin nuevo
 * cliente HTTP). La presentación (texto del mensaje) es responsabilidad de infraestructura.
 */
@Injectable()
export class PlanOfferWhatsappNotifier implements PlanOfferNotifier {
  // El sender es stateless (solo usa env + fetch); se compone aquí para reusar su lógica de envío.
  private readonly sender = new WhatsappTextSender();

  async sendPlanMenu(input: {
    channelId: string;
    recipient: string;
    plans: readonly PaymentPlan[];
  }): Promise<void> {
    const lines = input.plans.map(
      (plan, idx) => `${idx + 1}) ${describePlan(plan)}`,
    );
    const body = [
      'Tenés estos planes disponibles. Respondé con el número del que prefieras:',
      ...lines,
    ].join('\n');
    await this.send(input.channelId, input.recipient, body);
  }

  async sendScheduleForAcceptance(input: {
    channelId: string;
    recipient: string;
    plan: PaymentPlan;
    principalMinor: number;
    currency: string;
    schedule: readonly ScheduledInstallment[];
  }): Promise<void> {
    const rows = input.schedule.map(
      (i) => `${i.dueDate} — ${formatMoney(i.amountDueMinor, input.currency)}`,
    );
    const total = input.schedule.reduce((acc, i) => acc + i.amountDueMinor, 0);
    const body = [
      `¡Buenas noticias! 🎉 Luego de estudiar tu solicitud, tenemos un crédito de ${formatMoney(input.principalMinor, input.currency)} para ofrecerte.`,
      `Tu plan de pago (${input.plan.name}) quedaría así:`,
      ...rows,
      `Total a pagar: ${formatMoney(total, input.currency)} en ${input.plan.installmentsCount} cuotas (${FREQUENCY_LABEL[input.plan.frequency]}).`,
      '¿Aceptás tomar el crédito? Respondé SÍ o NO.',
    ].join('\n');
    await this.send(input.channelId, input.recipient, body);
  }

  async sendSelectionReask(input: {
    channelId: string;
    recipient: string;
    plans: readonly PaymentPlan[];
  }): Promise<void> {
    const lines = input.plans.map(
      (plan, idx) => `${idx + 1}) ${describePlan(plan)}`,
    );
    const body = [
      'No entendí tu elección. Respondé con el número del plan:',
      ...lines,
    ].join('\n');
    await this.send(input.channelId, input.recipient, body);
  }

  async sendAcceptanceReask(input: {
    channelId: string;
    recipient: string;
  }): Promise<void> {
    await this.send(
      input.channelId,
      input.recipient,
      '¿Aceptás tomar el crédito con ese plan? Respondé SÍ o NO.',
    );
  }

  async sendAcknowledgement(input: {
    channelId: string;
    recipient: string;
    decision: 'ACCEPT' | 'DECLINE';
  }): Promise<void> {
    const body =
      input.decision === 'ACCEPT'
        ? '¡Listo! Registramos tu aceptación. Un asesor confirmará el desembolso.'
        : 'Entendido, no avanzamos con el crédito. Quedamos atentos si cambiás de opinión.';
    await this.send(input.channelId, input.recipient, body);
  }

  async sendOfferExpired(input: {
    channelId: string;
    recipient: string;
  }): Promise<void> {
    await this.send(
      input.channelId,
      input.recipient,
      'Tu oferta venció. Un asesor te contactará para retomar el proceso.',
    );
  }

  private async send(
    channelId: string,
    recipient: string,
    body: string,
  ): Promise<void> {
    await this.sender.sendText({ channelId, recipient }, body);
  }
}

/** Describe un plan para el menú: "Plan 20 días — 20 cuotas diario · 20%". */
function describePlan(plan: PaymentPlan): string {
  return `${plan.name} — ${plan.installmentsCount} cuotas ${FREQUENCY_LABEL[plan.frequency]} · ${plan.interestPct / 10}%`;
}

/** Formatea unidades menores como moneda legible: 500000 → "COP 5.000". */
function formatMoney(amountMinor: number, currency: string): string {
  const major = Math.round(amountMinor / 100);
  return `${currency} ${major.toLocaleString('es-CO')}`;
}
