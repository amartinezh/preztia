// Consulta de cuenta por WhatsApp (reglas PURAS, sin I/O): (1) detectar cuándo un cliente pide su
// SALDO o el MOVIMIENTO de sus pagos y (2) redactar la respuesta con el estado de su crédito. El
// "cómo" (Drizzle, WhatsApp, BD) vive en infraestructura; aquí solo texto y montos. Es análogo a
// `payment-intent`, pero informativo: no genera cobros, solo comunica cuánto debe y qué ha pagado.

import { formatMoneyMinor } from "../collection/collection-reminder";

/** Intención informativa detectada: ver el saldo o ver el listado de pagos (movimiento). */
export type AccountInquiryKind = "balance" | "movements";

// Frases que piden ver el MOVIMIENTO (listado de pagos). Se evalúan ANTES que las de saldo porque
// son más específicas ("mis pagos", "historial") y también deben mostrar el saldo. ES + PT-BR.
const MOVEMENTS_PATTERNS: readonly RegExp[] = [
  /\bmovimiento/, // movimiento, movimientos
  /\bmovimenta/, // PT: movimentação, movimentos
  /\bhistorial\b/, // historial (de pagos)
  /\bhistorico\b/, // PT/ES sin acento: histórico
  /\bextracto\b/, // extracto
  /\bextrato\b/, // PT: extrato
  /\b(mis|los) pagos\b/, // mis pagos, los pagos
  /\b(meus|os) pagamentos\b/, // PT: meus/os pagamentos
  /\bque he pagado\b/, // "lo que he pagado", "cuánto que he pagado"
  /\bque llevo pagado\b/, // "lo que llevo pagado"
  /\bmis abonos\b/, // mis abonos
];

// Frases que piden el SALDO (cuánto debe / cuánto le falta). ES + PT-BR.
const BALANCE_PATTERNS: readonly RegExp[] = [
  /\bsaldo\b/, // saldo
  /\bcuanto debo\b/, // cuánto debo
  /\bcuanto le debo\b/, // cuánto le debo
  /\bcuanto les debo\b/, // cuánto les debo
  /\bcuanto devo\b/, // PT: quanto devo
  /\bcuanto me falta\b/, // cuánto me falta
  /\bcuanto falta\b/, // cuánto falta (por pagar)
  /\bcuanto llevo\b/, // cuánto llevo (pagado/abonado)
  /\bmi deuda\b/, // mi deuda
  /\bminha divida\b/, // PT: minha dívida
  /\bestado de (mi )?cuenta\b/, // estado de cuenta
  /\bcomo (voy|vou|va) con (mi|el) (credito|pago|prestamo)\b/, // cómo voy con mi crédito
];

/**
 * ¿El mensaje pide información de la cuenta? Devuelve `"movements"` (listado de pagos) o `"balance"`
 * (saldo), o `null` si no aplica. Determinista y barato: corre ANTES del asistente de IA, igual que
 * `detectPaymentIntent`, para atender al cliente con crédito activo sin depender de que haya IA.
 */
export function detectAccountInquiry(text: string): AccountInquiryKind | null {
  const normalized = normalize(text);
  if (normalized.length === 0) return null;
  if (MOVEMENTS_PATTERNS.some((re) => re.test(normalized))) return "movements";
  if (BALANCE_PATTERNS.some((re) => re.test(normalized))) return "balance";
  return null;
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

/** Un movimiento (abono) del cliente para el listado. */
export interface AccountMovementLine {
  /** Fecha del abono (ISO `YYYY-MM-DD`). */
  readonly date: string;
  readonly amountMinor: number;
}

/**
 * Estado de UN crédito activo del cliente. Un mismo cliente (teléfono) puede tener VARIOS créditos
 * activos a la vez (otorgados por distintas vías: WhatsApp o panel), por lo que la respuesta los
 * enumera todos.
 */
export interface AccountCreditLine {
  /** Fecha de inicio del crédito (ISO `YYYY-MM-DD`), para distinguirlo cuando hay varios. */
  readonly startDate: string;
  /** Valor total a pagar del crédito (capital + interés) = Σ cuotas. */
  readonly totalDueMinor: number;
  /** Total abonado a la fecha. */
  readonly totalPaidMinor: number;
  /** Saldo pendiente (lo que le falta por pagar) = total − abonado. Nunca negativo. */
  readonly outstandingMinor: number;
  /** Lo que debe a la fecha para estar al día (vencido a hoy, incluida la cuota de hoy). */
  readonly dueTodayMinor: number;
  /** Saldo en mora (estrictamente atrasado: vencido antes de hoy, sin pagar). 0 si está al día. */
  readonly overdueMinor: number;
  /** Abonos del crédito, del más reciente al más antiguo (ya limitados por la infraestructura). */
  readonly movements: readonly AccountMovementLine[];
}

/** Estado de cuenta del cliente: todos sus créditos activos. Se asume ≥ 1 crédito. */
export interface AccountStatementMessageData {
  readonly firstName: string;
  readonly currency: string;
  /** Créditos activos del cliente, del más reciente al más antiguo. Al menos uno. */
  readonly credits: readonly AccountCreditLine[];
}

/**
 * Redacta la respuesta al SALDO. Con un solo crédito muestra el detalle completo (total, abonado, lo
 * que falta, lo que debe a la fecha y la mora). Con varios, resume cada crédito y agrega el total
 * consolidado. En todos los casos incluye el saldo en mora.
 */
export function buildAccountBalanceMessage(data: AccountStatementMessageData): string {
  if (data.credits.length === 1) {
    const credit = data.credits[0]!;
    return [
      `¡Hola ${data.firstName}! 👋 Este es el estado de tu crédito:`,
      "",
      `💳 Valor total del crédito: ${money(credit.totalDueMinor, data.currency)}`,
      `✅ Has abonado: ${money(credit.totalPaidMinor, data.currency)}`,
      `📌 Te falta por pagar: ${money(credit.outstandingMinor, data.currency)}`,
      `📅 Debes a la fecha: ${money(credit.dueTodayMinor, data.currency)}`,
      overdueLine(credit.overdueMinor, data.currency),
    ].join("\n");
  }

  const lines = [`¡Hola ${data.firstName}! 👋 Tienes ${data.credits.length} créditos activos:`];
  let totalOutstanding = 0;
  let totalOverdue = 0;
  for (const credit of data.credits) {
    totalOutstanding += credit.outstandingMinor;
    totalOverdue += credit.overdueMinor;
    lines.push(
      "",
      `📄 ${creditLabel(credit, data.currency)}`,
      `   📌 Te falta por pagar: ${money(credit.outstandingMinor, data.currency)}`,
      `   📅 Debes a la fecha: ${money(credit.dueTodayMinor, data.currency)}`,
      `   ${compactOverdueLine(credit.overdueMinor, data.currency)}`,
    );
  }
  lines.push(
    "",
    "━━━━━━━━━━━━",
    `📊 En total te falta por pagar: ${money(totalOutstanding, data.currency)}`,
    totalOverdue > 0
      ? `⚠️ En mora (total): ${money(totalOverdue, data.currency)}`
      : "🟢 ¡Estás al día en todos tus créditos! 🎉",
  );
  return lines.join("\n");
}

/**
 * Redacta la respuesta al MOVIMIENTO: por cada crédito activo lista sus pagos (fecha — monto), el
 * saldo pendiente y el saldo en mora. Con un solo crédito usa un formato simple; con varios, una
 * sección por crédito. Si un crédito aún no registra pagos, lo indica en vez de una lista vacía.
 */
export function buildAccountMovementsMessage(data: AccountStatementMessageData): string {
  if (data.credits.length === 1) {
    const credit = data.credits[0]!;
    const lines = [`¡Hola ${data.firstName}! 👋 Estos son los pagos de tu crédito:`, ""];
    appendMovements(lines, credit, data.currency, "");
    lines.push(
      "",
      `📌 Te falta por pagar: ${money(credit.outstandingMinor, data.currency)}`,
      overdueLine(credit.overdueMinor, data.currency),
    );
    return lines.join("\n");
  }

  const lines = [`¡Hola ${data.firstName}! 👋 Estos son los pagos de tus créditos activos:`];
  for (const credit of data.credits) {
    lines.push("", `📄 ${creditLabel(credit, data.currency)}`);
    appendMovements(lines, credit, data.currency, "   ");
    lines.push(
      `   📌 Te falta: ${money(credit.outstandingMinor, data.currency)} · ${compactOverdueLine(
        credit.overdueMinor,
        data.currency,
      )}`,
    );
  }
  return lines.join("\n");
}

/** Agrega al mensaje las líneas de abonos de un crédito (o el aviso de que aún no hay pagos). */
function appendMovements(
  lines: string[],
  credit: AccountCreditLine,
  currency: string,
  indent: string,
): void {
  if (credit.movements.length === 0) {
    lines.push(`${indent}Aún no registramos pagos.`);
    return;
  }
  for (const movement of credit.movements) {
    lines.push(`${indent}• ${movement.date} — ${money(movement.amountMinor, currency)}`);
  }
}

/** Etiqueta de un crédito para distinguirlo entre varios: valor total + fecha de inicio. */
function creditLabel(credit: AccountCreditLine, currency: string): string {
  return `Crédito de ${money(credit.totalDueMinor, currency)} · desde ${formatBusinessDate(credit.startDate)}`;
}

/** Formatea `YYYY-MM-DD` a `DD/MM/YYYY` (uso local); devuelve el original si no tiene ese formato. */
function formatBusinessDate(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** Atajo para formatear dinero en la moneda del estado de cuenta. */
function money(amountMinor: number, currency: string): string {
  return formatMoneyMinor(amountMinor, currency);
}

/** Línea del saldo en mora (detalle): alerta si hay atraso; felicitación si está al día. */
function overdueLine(overdueMinor: number, currency: string): string {
  return overdueMinor > 0
    ? `⚠️ En mora (atrasado): ${money(overdueMinor, currency)}`
    : "🟢 En mora: ¡estás al día! 🎉";
}

/** Línea del saldo en mora (compacta, para el resumen por crédito). */
function compactOverdueLine(overdueMinor: number, currency: string): string {
  return overdueMinor > 0 ? `⚠️ En mora: ${money(overdueMinor, currency)}` : "🟢 Al día";
}

/** Aviso cuando el cliente pide su cuenta pero no tiene un crédito activo asociado al número. */
export const NO_ACTIVE_CREDIT_ACCOUNT =
  "No encontramos un crédito activo asociado a este número. Si crees que es un error, un asesor te ayudará. 🙏";
