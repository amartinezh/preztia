// Cobro conversacional por WhatsApp (reglas PURAS, sin I/O): (1) detectar cuándo un cliente
// EXPRESA que quiere pagar, en cualquier momento del chat; (2) interpretar cuánto quiere pagar
// (una cuota / todo lo atrasado / un monto libre); (3) redactar los mensajes del diálogo. El
// "cómo" (PicPay, WhatsApp, BD) vive en infraestructura; aquí solo texto y montos.

import { formatMoneyMinor } from "../collection/collection-reminder";

// Verbos/frases que, en esencia, significan "quiero pagar" (ES + PT-BR). Se normaliza el texto
// (minúsculas, sin acentos) y se busca cualquiera como subcadena de palabra. La detección es
// deliberadamente AMPLIA: ofrecer las opciones de pago es inocuo, y un falso positivo se resuelve
// con que el cliente ignore el menú. Debe evitar solo lo que claramente NO es intención de pago.
const PAYMENT_INTENT_PATTERNS: readonly RegExp[] = [
  /\bpagar\b/, // pagar, quiero pagar, voy a pagar, deseo pagar (ES/PT)
  /\bpago\b/, // hacer un pago, realizar el pago, mi pago
  /\bpagamento\b/, // PT: pagamento
  /\bpager\b/, // errata común
  /\babonar\b/, // abonar
  /\babono\b/, // hacer un abono
  /\bquitar\b/, // quitar la deuda (ES/PT)
  /\bcancelar (mi|la|una|as|minha)? ?(cuota|deuda|parcela|divida)\b/, // "cancelar" = saldar (contexto cobro)
  /\bpix\b/, // "quiero pagar por pix" / "manda el pix"
];

/**
 * ¿El mensaje expresa, en esencia, que el cliente quiere pagar? Determinista y barato: corre
 * ANTES del asistente de IA para no depender de que haya IA configurada.
 */
export function detectPaymentIntent(text: string): boolean {
  const normalized = normalize(text);
  if (normalized.length === 0) return false;
  return PAYMENT_INTENT_PATTERNS.some((re) => re.test(normalized));
}

/** Minúsculas + sin acentos + espacios colapsados (comparación estable, sin locale). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Montos ofrecidos al cliente para el cobro (unidades menores). */
export interface PaymentAmountOptions {
  /** Una cuota (la del día). */
  readonly installmentMinor: number;
  /** Todo lo vencido a hoy (cuota del día + atrasos). */
  readonly overdueMinor: number;
}

/** Elección del cliente ya interpretada: cuánto pagar y de qué opción provino. */
export type PaymentChoice =
  | { readonly kind: "installment" | "overdue" | "custom"; readonly amountMinor: number }
  | { readonly kind: "reask" };

const MINOR_PER_MAJOR = 100;
const OPTION_INSTALLMENT = /^(1|una|uma|cuota|parcela|la cuota)$/;
const OPTION_OVERDUE = /^(2|todo|tudo|todo lo atrasado|total|el total|atrasado|atrasos)$/;

/**
 * Interpreta la respuesta del cliente al menú de pago:
 *  - "1" / "cuota" / "parcela"      → la cuota del día (installment)
 *  - "2" / "todo" / "total"         → todo lo vencido (overdue)
 *  - un monto ("150", "R$ 150,50")  → pago libre (custom), aunque sea MENOR que la cuota
 *  - ilegible / cero                → reask
 * Los selectores "1"/"2" tienen prioridad sobre el monto libre (convención del menú), así que un
 * cliente que quiera pagar exactamente 1 o 2 (mayores) debe escribir el monto con decimales.
 */
export function parsePaymentChoice(
  text: string,
  options: PaymentAmountOptions,
): PaymentChoice {
  const normalized = normalize(text);
  if (OPTION_INSTALLMENT.test(normalized) && options.installmentMinor > 0) {
    return { kind: "installment", amountMinor: options.installmentMinor };
  }
  if (OPTION_OVERDUE.test(normalized) && options.overdueMinor > 0) {
    return { kind: "overdue", amountMinor: options.overdueMinor };
  }
  const custom = parseAmountMinor(normalized);
  if (custom !== null) return { kind: "custom", amountMinor: custom };
  return { kind: "reask" };
}

/**
 * Interpreta un monto en unidades MENORES desde un texto libre. Reconoce el separador decimal
 * (coma o punto con exactamente 2 decimales, estilo "150,50" / "150.50"); en su ausencia toma los
 * dígitos como unidades MAYORES ("150" → 15000). `null` si no hay un monto positivo interpretable.
 */
function parseAmountMinor(text: string): number | null {
  const decimal = text.match(/(\d{1,3}(?:[.\s]?\d{3})*|\d+)[.,](\d{2})(?!\d)/);
  if (decimal) {
    const whole = Number(decimal[1]!.replace(/[.\s]/g, ""));
    const cents = Number(decimal[2]);
    if (!Number.isSafeInteger(whole)) return null;
    const minor = whole * MINOR_PER_MAJOR + cents;
    return minor > 0 ? minor : null;
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const major = Number(digits);
  if (!Number.isSafeInteger(major) || major <= 0) return null;
  return major * MINOR_PER_MAJOR;
}

/** Datos para redactar el menú de opciones de pago. */
export interface PaymentOptionsMessageData {
  readonly firstName: string;
  readonly installmentMinor: number;
  readonly overdueMinor: number;
  readonly currency: string;
}

/**
 * Redacta el menú de cobro: saluda, ofrece pagar la cuota del día o todo lo vencido, e invita a
 * escribir un monto libre (se recibe cualquier abono). Cuando lo vencido iguala a la cuota (no hay
 * atrasos), se omite la opción 2 para no confundir.
 */
export function buildPaymentOptionsMessage(data: PaymentOptionsMessageData): string {
  const cuota = formatMoneyMinor(data.installmentMinor, data.currency);
  const lines = [
    `¡Hola ${data.firstName}! 👋 Con gusto tomamos tu pago.`,
    "",
    "¿Cuánto deseas pagar hoy? Responde con el número o escribe otro valor:",
    `*1️⃣* Tu cuota de hoy — ${cuota}`,
  ];
  if (data.overdueMinor > data.installmentMinor) {
    lines.push(
      `*2️⃣* Todo lo pendiente — ${formatMoneyMinor(data.overdueMinor, data.currency)}`,
    );
  }
  lines.push(
    "",
    "También puedes responder con *otro monto* (por ejemplo: 150) y generamos tu cobro por ese valor. 💚",
  );
  return lines.join("\n");
}

/** Datos para redactar las instrucciones de pago con el código PIX generado. */
export interface ChargeInstructionsMessageData {
  readonly amountMinor: number;
  readonly currency: string;
  /** Código PIX "copia e cola" devuelto por el proveedor. */
  readonly copyPasteCode: string;
  /** Minutos de validez del código (para avisar el vencimiento). */
  readonly expiresInMinutes: number;
}

/** Redacta el mensaje con el PIX copia-e-cola para que el cliente pague el monto elegido. */
export function buildChargeInstructionsMessage(
  data: ChargeInstructionsMessageData,
): string {
  const amount = formatMoneyMinor(data.amountMinor, data.currency);
  return [
    `Perfecto ✅ Generamos tu cobro por *${amount}*.`,
    "",
    "Copia el siguiente código *PIX* y págalo desde tu banco (Pix → Pix Copia e Cola):",
    "",
    data.copyPasteCode,
    "",
    `El código vence en ${data.expiresInMinutes} minutos. Apenas confirmemos el pago, te avisamos por aquí. 🙏`,
  ].join("\n");
}

/** Aviso cuando no se pudo interpretar la elección: se vuelve a pedir. */
export const PAYMENT_CHOICE_REASK =
  "No entendí el monto 🤔. Responde *1* para tu cuota de hoy, *2* para todo lo pendiente, o escribe un valor (por ejemplo: 150).";

/** Aviso cuando el cliente quiere pagar pero no tiene un crédito activo. */
export const NO_ACTIVE_CREDIT_TO_PAY =
  "No encontramos un crédito activo asociado a este número. Si crees que es un error, un asesor te ayudará. 🙏";

/** Aviso cuando falla la generación del cobro en el proveedor (degradación elegante). */
export const CHARGE_CREATION_FAILED =
  "Tuvimos un problema al generar tu cobro en este momento 😞. Por favor inténtalo de nuevo en unos minutos.";
