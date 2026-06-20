// Cobranza por WhatsApp: reglas PURAS para (1) calcular cuánto debe pagar HOY un cliente
// según su cartera y (2) redactar el recordatorio de cobro con tono amable + invitación PIX.
// No conoce I/O, NestJS, Drizzle ni HTTP: recibe datos ya cargados y devuelve valores.

import { DomainError } from "../../shared/money";
import { remainingMinor, type PortfolioInstallment } from "../portfolio/installment";

/**
 * Monto exacto a pagar a una fecha (`asOf`, ISO `YYYY-MM-DD`): la suma del SALDO pendiente de
 * toda cuota cuyo vencimiento ya llegó (vigente de hoy + atrasos) y que no esté saldada. Reusa
 * el invariante `remainingMinor` (abonos ≤ valor), por lo que el resultado nunca es negativo.
 */
export function dailyDueMinor(
  installments: readonly PortfolioInstallment[],
  asOf: string,
): number {
  return installments
    .filter((i) => i.status !== "PAID" && i.dueDate <= asOf)
    .reduce((acc, i) => acc + remainingMinor(i), 0);
}

/** Datos que el caso de uso entrega al redactor del mensaje (ya resueltos por la infraestructura). */
export interface CollectionReminderData {
  /** Nombre de pila del cliente para el saludo. */
  readonly firstName: string;
  /** Cuota a pagar hoy, en unidades menores (entero). Debe ser > 0. */
  readonly dueMinor: number;
  /** Moneda ISO 4217 del tenant (ej. "BRL", "COP"). */
  readonly currency: string;
  /** Llave PIX del tenant para recibir la transferencia. */
  readonly pixKey: string;
}

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = {
  BRL: "R$",
  COP: "$",
  USD: "US$",
};

/**
 * Formatea unidades menores a un texto monetario estable (sin `Intl`, determinista para pruebas):
 * miles con punto y centavos con coma (estilo R$ del contexto PIX). Ej.: 123456 BRL → "R$ 1.234,56".
 */
export function formatMoneyMinor(amountMinor: number, currency: string): string {
  if (!Number.isInteger(amountMinor)) {
    throw new DomainError("El monto debe ser entero (unidades menores)");
  }
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 100);
  const cents = (abs % 100).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = amountMinor < 0 ? "-" : "";
  return `${sign}${symbol} ${grouped},${cents}`;
}

/**
 * Redacta el recordatorio de cobro: saludo amable, cuota del día, invitación a pagar por PIX a la
 * llave del tenant y a responder con la FOTO del comprobante en este mismo hilo de WhatsApp.
 * Falla rápido si no hay nada que cobrar (la decisión de no enviar es del caso de uso).
 */
export function buildCollectionReminderMessage(data: CollectionReminderData): string {
  if (data.dueMinor <= 0) {
    throw new DomainError("No hay cuota por cobrar: no se debe construir un recordatorio");
  }
  const amount = formatMoneyMinor(data.dueMinor, data.currency);
  return [
    `¡Hola ${data.firstName}! 👋`,
    "",
    `Te recordamos que tu cuota de hoy es de ${amount}.`,
    `Por favor realiza tu pago hoy mediante una transferencia *PIX* a la llave:`,
    data.pixKey,
    "",
    "Cuando completes el pago, envíanos la *foto del comprobante* respondiendo " +
      "directamente a este mismo chat. 🙏",
    "",
    "¡Gracias por tu puntualidad! 😊",
  ].join("\n");
}
