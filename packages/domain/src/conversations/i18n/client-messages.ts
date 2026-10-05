import type { ScheduleFrequency } from "../../credit/schedule";
import type { TelegramContactRejection } from "../telegram-contact";
import { DEFAULT_CLIENT_LANGUAGE, type ClientLanguage } from "./client-language";
import { ES_CLIENT_MESSAGES } from "./messages.es";
import { PT_BR_CLIENT_MESSAGES } from "./messages.pt-br";

// Catálogo de TODOS los textos que el sistema envía al cliente por chat. Es el contrato de un
// diccionario: cada idioma implementa la interfaz completa, así que olvidar una clave es un error
// de compilación (no un texto en otro idioma colado en la conversación). Los montos llegan ya
// formateados: el catálogo solo redacta, no calcula ni formatea dinero.

/** Asistente de conocimiento (IA) y sus respuestas fijas. */
export interface AssistantMessages {
  readonly offTopic: string;
  readonly unavailable: string;
  committedApplicant(supportPhone: string | null): string;
}

/** Solicitud de crédito por chat: monto, documentos y ubicación. */
export interface ApplicationMessages {
  readonly intro: string;
  readonly amountQuestion: string;
  readonly resume: string;
  readonly alreadySubmitted: string;
  readonly restart: string;
  readonly amountOk: string;
  readonly amountReask: string;
  readonly completed: string;
  readonly alreadyComplete: string;
  readonly fileReceived: string;
  readonly fileReceivedForManualReview: string;
  readonly offerManualReview: string;
  readonly locationReceived: string;
  /** Pedido de un documento sin título configurado (cae al nombre técnico). */
  documentFallback(documentType: string): string;
  remainingFiles(missing: number): string;
  /** `reasons` son los motivos del antifraude estructural (texto interno, en español). */
  structuralReject(reasons: readonly string[], prompt: string): string;
  mismatchRetry(input: { detected: string | null; prompt: string; attemptsLeft: number }): string;
  pendingReminder(documentTitle: string): string;
}

/** Comprobantes de pago (foto/PDF del PIX) y su conciliación. */
export interface ReceiptMessages {
  readonly noActiveCredit: string;
  readonly notAReceipt: string;
  readonly inVerification: string;
  readonly unreadable: string;
  readonly underReview: string;
  settled(input: { paid: string; overpayment: string | null }): string;
  allocated(input: { paid: string; installments: number; remaining: string }): string;
  readonly bankConfirmedSettled: string;
  bankConfirmed(remaining: string): string;
  readonly confirmedSettled: string;
  readonly confirmed: string;
}

/** Cobro conversacional (menú de montos + PIX copia e cola). */
export interface ChargeMessages {
  paymentOptions(input: { firstName: string; installment: string; overdue: string | null }): string;
  chargeInstructions(input: { amount: string; copyPasteCode: string; expiresInMinutes: number }): string;
  readonly choiceReask: string;
  readonly noActiveCredit: string;
  readonly creationFailed: string;
}

/** Piezas del estado de cuenta (saldo y movimientos); el armado vive en `account-inquiry`. */
export interface AccountMessages {
  balanceIntroSingle(firstName: string): string;
  balanceIntroMulti(firstName: string, credits: number): string;
  movementsIntroSingle(firstName: string): string;
  movementsIntroMulti(firstName: string): string;
  totalDue(amount: string): string;
  paid(amount: string): string;
  outstanding(amount: string): string;
  outstandingShort(amount: string): string;
  dueToday(amount: string): string;
  totalOutstanding(amount: string): string;
  totalOverdue(amount: string): string;
  readonly allUpToDate: string;
  overdueDetail(amount: string): string;
  readonly upToDateDetail: string;
  overdueCompact(amount: string): string;
  readonly upToDateCompact: string;
  readonly noPayments: string;
  creditLabel(total: string, startDate: string): string;
  readonly noActiveCredit: string;
}

/** Recordatorio de cobro (cron o envío manual desde Cartera). */
export interface ReminderMessages {
  collectionReminder(input: { firstName: string; amount: string; pixKey: string }): string;
}

/** Negociación del plan de pago por chat. */
export interface PlanMessages {
  readonly frequency: Readonly<Record<ScheduleFrequency, string>>;
  planLine(input: { name: string; installments: number; frequency: string; interestPct: number }): string;
  menu(planLines: readonly string[]): string;
  offer(input: {
    principal: string;
    planName: string;
    scheduleRows: readonly string[];
    total: string;
    installments: number;
    frequency: string;
  }): string;
  selectionReask(planLines: readonly string[]): string;
  readonly acceptanceReask: string;
  readonly accepted: string;
  readonly declined: string;
  readonly expired: string;
}

/** Aviso de crédito registrado tras la aprobación. */
export interface CreditMessages {
  registered(supportPhone: string | null): string;
}

/** Verificación de identidad en Telegram (botón nativo de compartir contacto). */
export interface TelegramMessages {
  readonly shareContactButton: string;
  readonly shareContactPlaceholder: string;
  readonly requestContact: string;
  readonly identified: string;
  readonly rejection: Readonly<Record<TelegramContactRejection, string>>;
}

export interface ClientMessages {
  readonly assistant: AssistantMessages;
  readonly application: ApplicationMessages;
  readonly receipt: ReceiptMessages;
  readonly charge: ChargeMessages;
  readonly account: AccountMessages;
  readonly reminder: ReminderMessages;
  readonly plan: PlanMessages;
  readonly credit: CreditMessages;
  readonly telegram: TelegramMessages;
}

// `Record` sobre la unión de idiomas: un idioma nuevo sin diccionario no compila.
const CLIENT_MESSAGES: Readonly<Record<ClientLanguage, ClientMessages>> = {
  es: ES_CLIENT_MESSAGES,
  "pt-BR": PT_BR_CLIENT_MESSAGES,
};

/** Diccionario de mensajes al cliente para el idioma configurado del tenant. */
export function clientMessagesFor(language: ClientLanguage = DEFAULT_CLIENT_LANGUAGE): ClientMessages {
  return CLIENT_MESSAGES[language];
}
