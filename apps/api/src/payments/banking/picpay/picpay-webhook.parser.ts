import { z } from 'zod';
import { type NormalizedCredit } from '@preztiaos/domain';

// Parser DEFENSIVO del webhook `TransactionUpdateMessage` de PicPay (API Pix). La forma exacta
// puede variar por versión del producto, así que todo campo es opcional y la normalización
// degrada a `credit: null` (se registra la notificación pero no se ingiere un crédito). Solo un
// evento PAID con monto > 0 produce un crédito; cancelaciones/expiraciones quedan solo en la
// bitácora `provider_webhook_event`.

const PAID_STATUS = 'PAID';
// Se normaliza al método que el filtro de elegibilidad del dominio reconoce como PIX (I3).
const PIX_METHOD = 'bank_transfer';
const PICPAY_TRANSACTION_TYPE = 'payment';

const id = z.union([z.string(), z.number()]).transform(String);

const pixSchema = z.object({ endToEndId: z.string().optional() }).passthrough();

const transactionSchema = z
  .object({
    paymentType: z.string().optional(),
    transactionStatus: z.string().optional(),
    amount: z.number().optional(),
    pix: pixSchema.optional(),
  })
  .passthrough();

const webhookSchema = z
  .object({
    id: id.optional(),
    type: z.string().optional(),
    eventDate: z.string().optional(),
    data: z
      .object({
        status: z.string().optional(),
        amount: z.number().optional(),
        merchantChargeId: z.string().optional(),
        transactions: z.array(transactionSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Notificación de PicPay ya normalizada: qué registrar y, si aplica, qué crédito ingerir. */
export interface PicPayWebhookEvent {
  /** Identificador idempotente del evento (id del webhook, o cobro+estado como respaldo). */
  readonly eventId: string;
  readonly eventType: string;
  readonly status: string | null;
  /** Referencia de la cobrança (para emparejar con `payment_charge`); null si no viene. */
  readonly merchantChargeId: string | null;
  /** Crédito PIX real a ingerir (solo PAID con monto > 0); null en el resto de eventos. */
  readonly credit: NormalizedCredit | null;
}

/**
 * Interpreta el payload del webhook. `eventTypeHeader` es el header `event-type` de PicPay
 * (ej. "TransactionUpdateMessage"); si falta se usa `type` del payload.
 */
export function parsePicPayWebhook(
  body: unknown,
  eventTypeHeader: string | undefined,
): PicPayWebhookEvent | null {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return null;
  const payload = parsed.data;
  const data = payload.data;

  const status = data?.status?.toUpperCase() ?? null;
  const merchantChargeId = data?.merchantChargeId ?? null;
  const eventId =
    payload.id ??
    (merchantChargeId ? `${merchantChargeId}:${status ?? 'UNKNOWN'}` : null);
  if (!eventId) return null; // sin identificador no hay registro idempotente posible

  return {
    eventId,
    eventType: eventTypeHeader ?? payload.type ?? 'unknown',
    status,
    merchantChargeId,
    credit: toCredit(payload, status, merchantChargeId),
  };
}

/** Normaliza un evento PAID a crédito PIX; montos de PicPay ya vienen en centavos. */
function toCredit(
  payload: z.infer<typeof webhookSchema>,
  status: string | null,
  merchantChargeId: string | null,
): NormalizedCredit | null {
  if (status !== PAID_STATUS) return null;
  const data = payload.data;
  if (!data) return null;

  const pixTransaction = (data.transactions ?? []).find(
    (t) => (t.paymentType ?? 'PIX').toUpperCase() === 'PIX',
  );
  const amountMinor = pixTransaction?.amount ?? data.amount ?? 0;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return null;

  const endToEndId = pixTransaction?.pix?.endToEndId ?? null;
  // Idempotencia de ingestión: el E2E identifica la transacción PIX; el cobro es el respaldo.
  const sourceId = endToEndId ?? merchantChargeId;
  if (!sourceId) return null;

  return {
    sourceId,
    amountMinor,
    // PicPay no reporta el neto en el webhook: se usa el bruto (el fee se concilia en caja).
    netAmountMinor: amountMinor,
    currency: 'BRL',
    paymentMethodType: PIX_METHOD,
    transactionType: PICPAY_TRANSACTION_TYPE,
    settlementDate: payload.eventDate ?? new Date().toISOString(),
    endToEndId,
  };
}
