import { randomUUID } from 'node:crypto';
import { schema } from '@preztiaos/db';
import { formatMoneyMinor, type FraudStatus } from '@preztiaos/domain';
import { after, chatIn, chatOut, mediaId } from './chat';
import type { TenantContext } from './context';
import { endToEndId, formatCpf } from './fake-data';
import { ACCENTS, PNG_MIME, receiptPng } from './files';
import type {
  BankAccountRef,
  BoxState,
  CreditState,
  Row,
  UserRef,
} from './model';
import {
  applyAllocations,
  balanceOf,
  paymentRow,
  type AppliedPayment,
} from './portfolio';

// PAGOS PIX por comprobante (WhatsApp/Telegram): espejo de `SubmitPaymentReceiptHandler`,
// `CreditPortfolioDrizzleRepository`, `PaymentReconciliationDrizzleRepository`,
// `ManualVerifyPaymentRepository` y del webhook de PicPay. Cada camino deja exactamente las filas,
// eventos y trazas antifraude (Fase 1 / Fase 2) que dejaría la API, y mueve el dinero a la caja
// bancaria por llave PIX (o a Tránsito si la llave no se reconoce) solo cuando el pago es VERIFIED.

const NOT_FOUND_REASON =
  'El banco aún no reporta esta transacción; queda en conciliación';
const UNAVAILABLE_REASON =
  'Verificación bancaria no disponible (timeout); queda en conciliación';
const MISMATCH_REASON =
  'El monto extraído del comprobante difiere del confirmado por el banco';
const DUPLICATE_REASON =
  'Comprobante duplicado: el mismo archivo ya fue presentado en otro pago';
const UNREADABLE_REASON = 'No se pudo leer el monto del comprobante';
const UNIDENTIFIED_REASON =
  'Pago no identificado: sin caja bancaria asociada a la llave PIX';
const SUSPICION_SCORE = 60;
const FRAUD_SCORE = 100;
/** Llave PIX vieja que ningún banco del tenant reconoce (el pago cae en Tránsito). */
export const UNKNOWN_PIX_KEY = 'pix.antigo@preztia.com.br';

export interface Receipt {
  readonly payment: Row<typeof schema.payment>;
  readonly credit: CreditState;
  readonly endToEndId: string;
  readonly channelId: string;
}

/**
 * Comprobante recibido: guarda la imagen cifrada, el transcript del mensaje y la fila del pago con
 * todo lo extraído. El estado y la verificación bancaria los fija cada flujo.
 */
export async function receiveReceipt(
  ctx: TenantContext,
  input: {
    credit: CreditState;
    amountMinor: number;
    /** Monto que leyó la IA (null = ilegible); por defecto el pagado. */
    extractedMinor?: number | null;
    receiverPixKey: string | null;
    at: Date;
    /** Reusar la imagen de otro comprobante (fraude por duplicado). */
    reuse?: { storageKey: string | null; sha256: string };
  },
): Promise<Receipt> {
  const { credit, at } = input;
  const borrower = credit.borrower;
  const channelId = ctx.channelFor(borrower.zone);
  const e2e = endToEndId(ctx.random, borrower.payerBank.ispb, at);
  const extracted =
    input.extractedMinor === undefined
      ? input.amountMinor
      : input.extractedMinor;
  const paymentId = randomUUID();
  const file = input.reuse
    ? {
        storageKey: input.reuse.storageKey,
        sha256: input.reuse.sha256,
        mimeType: PNG_MIME,
      }
    : await ctx.files.put(
        `payments/${ctx.tenantId}/${credit.id}/${randomUUID()}`,
        receiptPng(
          'COMPROVANTE PIX',
          receiptLines(ctx, { ...input, extracted, e2e }),
          ACCENTS.pix!,
        ),
        PNG_MIME,
      );
  const media = mediaId(ctx);
  const messageId = chatIn(ctx, {
    phone: borrower.phone,
    channelId,
    kind: 'image',
    body: null,
    mediaId: media,
    mimeType: PNG_MIME,
    at,
  });
  const payment: Row<typeof schema.payment> = {
    ...paymentRow(ctx, {
      id: paymentId,
      creditId: credit.id,
      amountMinor: extracted,
      paidAt: at,
      createdAt: at,
      status: 'RECEIVED',
      payerPhone: borrower.phone,
    }),
    providerMessageId: messageId,
    channelId,
    payerName: borrower.fullName.toUpperCase(),
    payerTaxId: borrower.nationalId,
    payerBankName: borrower.payerBank.name,
    receiverPixKey: input.receiverPixKey,
    endToEndId: extracted === null ? null : e2e,
    txid: null,
    extractionRaw:
      extracted === null
        ? { legible: false, observacao: 'Imagem desfocada: valor ilegível' }
        : {
            tipo: 'PIX',
            valor: formatMoneyMinor(extracted, ctx.currency),
            pagador: borrower.fullName,
            cpf_pagador: formatCpf(borrower.nationalId),
            banco_pagador: borrower.payerBank.name,
            chave_recebedor: input.receiverPixKey,
            end_to_end_id: e2e,
            data_hora: at.toISOString(),
          },
    sha256: file.sha256,
    storageKey: file.storageKey,
    mimeType: PNG_MIME,
  };
  ctx.batch.track(schema.payment, payment);
  ctx.stats.payments += 1;
  ctx.stats.pixPayments += 1;
  return { payment, credit, endToEndId: e2e, channelId };
}

function receiptLines(
  ctx: TenantContext,
  input: {
    credit: CreditState;
    extracted: number | null;
    receiverPixKey: string | null;
    at: Date;
    e2e: string;
  },
): string[] {
  const borrower = input.credit.borrower;
  return [
    `VALOR: ${input.extracted === null ? '???' : formatMoneyMinor(input.extracted, ctx.currency)}`,
    `DATA: ${input.at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `DE: ${borrower.fullName}`,
    `CPF: ${formatCpf(borrower.nationalId)}`,
    `BANCO: ${borrower.payerBank.name}`,
    `PARA: ${input.receiverPixKey ?? '-'}`,
    `ID: ${input.e2e.slice(0, 22)}`,
    `   ${input.e2e.slice(22)}`,
  ];
}

// ── Fase 1: decisión al recibir ─────────────────────────────────────────────────────────────

/** Banco CONFIRMA en línea (Inter): VERIFIED, abono, ruteo a la caja por llave PIX. */
export async function pixVerifiedOnline(
  ctx: TenantContext,
  input: {
    credit: CreditState;
    amountMinor: number;
    account: BankAccountRef;
    at: Date;
    /** Monto leído por la IA distinto del confirmado por el banco (sospechoso, se abona igual). */
    extractedMinor?: number;
    receiverPixKey?: string;
  },
): Promise<Receipt> {
  const receipt = await receiveReceipt(ctx, {
    credit: input.credit,
    amountMinor: input.amountMinor,
    extractedMinor: input.extractedMinor,
    receiverPixKey: input.receiverPixKey ?? input.account.pixKey,
    at: input.at,
  });
  const mismatch =
    input.extractedMinor !== undefined &&
    input.extractedMinor !== input.amountMinor;
  const reasons = mismatch ? [MISMATCH_REASON] : [];
  // Como en la API, el pago queda por el monto que CONFIRMÓ el banco (el que se abona y entra a la
  // caja); si la IA leyó otro, queda como evidencia en el evento de la decisión.
  Object.assign(receipt.payment, {
    amountMinor: input.amountMinor,
    status: 'VERIFIED',
    bankStatus: 'CONFIRMED',
    bankResponse: {
      provider: input.account.providerType,
      status: 'confirmed',
      endToEndId: receipt.endToEndId,
      amountMinor: input.amountMinor,
    },
    verifiedAt: input.at,
  });
  recordAssessment(
    ctx,
    receipt,
    'PHASE1_SCREEN',
    mismatch ? 'suspicious' : 'approved',
    mismatch ? SUSPICION_SCORE : 0,
    reasons,
    input.at,
  );
  event(
    ctx,
    receipt,
    'payment_verified',
    {
      creditId: input.credit.id,
      ...(reasons.length ? { reasons } : {}),
      ...(mismatch
        ? {
            extractedAmountMinor: input.extractedMinor,
            bankAmountMinor: input.amountMinor,
          }
        : {}),
    },
    input.at,
    1,
  );
  const applied = allocateWithEvents(ctx, receipt, input.amountMinor, input.at);
  routeToBox(ctx, receipt, input.amountMinor, input.at, null);
  replyAllocated(ctx, receipt, input.amountMinor, applied, input.at);
  return receipt;
}

/** El banco aún no lo reporta: UNVERIFIED (política HOLD: no se abona). */
export async function pixPendingBank(
  ctx: TenantContext,
  input: {
    credit: CreditState;
    amountMinor: number;
    account: BankAccountRef;
    at: Date;
    unavailable?: boolean;
    reconciliationAttempts?: number;
    lastReconciliationAt?: Date;
  },
): Promise<Receipt> {
  const receipt = await receiveReceipt(ctx, {
    credit: input.credit,
    amountMinor: input.amountMinor,
    receiverPixKey: input.account.pixKey,
    at: input.at,
  });
  const reason = input.unavailable ? UNAVAILABLE_REASON : NOT_FOUND_REASON;
  Object.assign(receipt.payment, {
    status: 'UNVERIFIED',
    bankStatus: input.unavailable ? 'UNAVAILABLE' : 'NOT_FOUND',
    bankResponse: {
      provider: input.account.providerType,
      status: input.unavailable ? 'unavailable' : 'not_found',
    },
    reconciliationAttempts: input.reconciliationAttempts ?? 0,
    lastReconciliationAt: input.lastReconciliationAt ?? null,
  });
  recordAssessment(ctx, receipt, 'PHASE1_SCREEN', 'approved', 0, [], input.at);
  event(
    ctx,
    receipt,
    'payment_unverified',
    { creditId: input.credit.id, reasons: [reason] },
    input.at,
    1,
  );
  chatOut(ctx, {
    phone: input.credit.borrower.phone,
    channelId: receipt.channelId,
    body: ctx.messages.receipt.inVerification,
    at: after(input.at, 4),
  });
  return receipt;
}

/** Comprobante con la misma imagen que uno anterior: REJECTED_FRAUD (no se abona). */
export async function pixRejectedDuplicate(
  ctx: TenantContext,
  input: {
    credit: CreditState;
    original: Receipt;
    account: BankAccountRef;
    at: Date;
  },
): Promise<Receipt> {
  const receipt = await receiveReceipt(ctx, {
    credit: input.credit,
    amountMinor: input.original.payment.amountMinor ?? 0,
    receiverPixKey: input.account.pixKey,
    at: input.at,
    reuse: {
      storageKey: input.original.payment.storageKey ?? null,
      sha256: input.original.payment.sha256 ?? '',
    },
  });
  Object.assign(receipt.payment, {
    status: 'REJECTED_FRAUD',
    bankStatus: 'NOT_FOUND',
    bankResponse: { provider: input.account.providerType, status: 'not_found' },
  });
  recordAssessment(
    ctx,
    receipt,
    'PHASE1_SCREEN',
    'rejected',
    FRAUD_SCORE,
    [DUPLICATE_REASON],
    input.at,
  );
  event(
    ctx,
    receipt,
    'payment_rejected_fraud',
    { creditId: input.credit.id, reasons: [DUPLICATE_REASON] },
    input.at,
    1,
  );
  chatOut(ctx, {
    phone: input.credit.borrower.phone,
    channelId: receipt.channelId,
    body: ctx.messages.receipt.underReview,
    at: after(input.at, 4),
  });
  return receipt;
}

/** Imagen ilegible: REJECTED_INVALID (se pide reenviar). */
export async function pixUnreadable(
  ctx: TenantContext,
  input: { credit: CreditState; account: BankAccountRef; at: Date },
): Promise<Receipt> {
  const receipt = await receiveReceipt(ctx, {
    credit: input.credit,
    amountMinor: 0,
    extractedMinor: null,
    receiverPixKey: input.account.pixKey,
    at: input.at,
  });
  Object.assign(receipt.payment, {
    status: 'REJECTED_INVALID',
    bankStatus: 'UNAVAILABLE',
  });
  recordAssessment(
    ctx,
    receipt,
    'PHASE1_SCREEN',
    'approved',
    null,
    [],
    input.at,
  );
  event(
    ctx,
    receipt,
    'payment_rejected_invalid',
    { creditId: input.credit.id, reasons: [UNREADABLE_REASON] },
    input.at,
    1,
  );
  chatOut(ctx, {
    phone: input.credit.borrower.phone,
    channelId: receipt.channelId,
    body: ctx.messages.receipt.unreadable,
    at: after(input.at, 4),
  });
  return receipt;
}

/** Comprobante de alguien sin crédito activo: huérfano RECEIVED (evidencia, sin abono). */
export async function pixOrphan(
  ctx: TenantContext,
  input: { credit: CreditState; phone: string; at: Date },
): Promise<void> {
  const channelId = ctx.channelFor(input.credit.zone);
  const messageId = chatIn(ctx, {
    phone: input.phone,
    channelId,
    kind: 'image',
    body: null,
    mediaId: mediaId(ctx),
    mimeType: PNG_MIME,
    at: input.at,
  });
  const file = await ctx.files.put(
    `payments/${ctx.tenantId}/unassigned/${randomUUID()}`,
    receiptPng(
      'COMPROVANTE PIX',
      [
        `VALOR: ${formatMoneyMinor(5000, ctx.currency)}`,
        'DE: CLIENTE NAO CADASTRADO',
      ],
      ACCENTS.pix!,
    ),
    PNG_MIME,
  );
  const id = randomUUID();
  ctx.batch.track(schema.payment, {
    ...paymentRow(ctx, {
      id,
      creditId: null,
      amountMinor: 5000,
      paidAt: input.at,
      createdAt: input.at,
      status: 'RECEIVED',
      payerPhone: input.phone,
    }),
    providerMessageId: messageId,
    channelId,
    receiverPixKey: [...ctx.accounts.values()][0]?.pixKey ?? null,
    sha256: file.sha256,
    storageKey: file.storageKey,
    mimeType: PNG_MIME,
  });
  ctx.batch.insert(schema.fraudAssessment, {
    tenantId: ctx.tenantId,
    paymentId: id,
    phase: 'PHASE1_SCREEN',
    status: 'approved',
    score: null,
    reasons: [],
    createdAt: input.at,
  });
  ctx.batch.insert(schema.paymentEvent, {
    tenantId: ctx.tenantId,
    paymentId: id,
    creditId: null,
    type: 'payment_received_orphan',
    payload: { payerPhone: input.phone },
    createdAt: after(input.at, 1),
  });
  chatOut(ctx, {
    phone: input.phone,
    channelId,
    body: ctx.messages.receipt.noActiveCredit,
    at: after(input.at, 4),
  });
  ctx.stats.payments += 1;
}

/** El mismo end-to-end reenviado: la API no inserta nada, solo audita el duplicado. */
export function pixDuplicateIgnored(
  ctx: TenantContext,
  original: Receipt,
  at: Date,
): void {
  chatIn(ctx, {
    phone: original.credit.borrower.phone,
    channelId: original.channelId,
    kind: 'image',
    body: null,
    mediaId: mediaId(ctx),
    mimeType: PNG_MIME,
    at,
  });
  ctx.batch.insert(schema.paymentEvent, {
    tenantId: ctx.tenantId,
    paymentId: null,
    creditId: original.credit.id,
    type: 'payment_duplicate_ignored',
    payload: { providerMessageId: original.payment.providerMessageId },
    createdAt: after(at, 1),
  });
}

// ── Fase 2: crédito real del proveedor (webhook PicPay) y conciliación ─────────────────────

export interface IncomingCredit {
  readonly row: Row<typeof schema.incomingCredit>;
}

/** Webhook PAID de PicPay: bitácora del evento + crédito real (ground truth). */
export function picpayWebhookPaid(
  ctx: TenantContext,
  input: {
    account: BankAccountRef;
    amountMinor: number;
    endToEndId: string | null;
    merchantChargeId?: string;
    at: Date;
  },
): IncomingCredit {
  const sourceId = input.endToEndId ?? required(input.merchantChargeId);
  const eventId = randomUUID();
  const payload = {
    id: eventId,
    type: 'TransactionUpdateMessage',
    eventDate: input.at.toISOString(),
    data: {
      status: 'PAID',
      amount: input.amountMinor,
      merchantChargeId: input.merchantChargeId ?? null,
      transactions: [
        {
          paymentType: 'PIX',
          amount: input.amountMinor,
          pix: { endToEndId: input.endToEndId },
        },
      ],
    },
  };
  ctx.batch.insert(schema.providerWebhookEvent, {
    tenantId: ctx.tenantId,
    bankAccountId: input.account.id,
    providerType: 'PICPAY',
    eventId,
    eventType: 'TransactionUpdateMessage',
    status: 'PAID',
    payload,
    receivedAt: input.at,
  });
  const row: Row<typeof schema.incomingCredit> = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    bankAccountId: input.account.id,
    sourceId,
    amountMinor: input.amountMinor,
    netAmountMinor: input.amountMinor,
    currency: ctx.currency,
    paymentMethodType: 'bank_transfer',
    transactionType: 'payment',
    endToEndId: input.endToEndId,
    settlementDate: input.at,
    consumedByPaymentId: null,
    consumedByFieldOrderId: null,
    raw: payload,
    createdAt: input.at,
  };
  ctx.batch.track(schema.incomingCredit, row);
  return { row };
}

/** Webhook de un estado no pagado (cancelado/expirado): solo bitácora. */
export function picpayWebhookStatus(
  ctx: TenantContext,
  input: {
    account: BankAccountRef;
    merchantChargeId: string;
    status: 'EXPIRED' | 'CANCELED';
    at: Date;
  },
): void {
  const eventId = `${input.merchantChargeId}:${input.status}`;
  ctx.batch.insert(schema.providerWebhookEvent, {
    tenantId: ctx.tenantId,
    bankAccountId: input.account.id,
    providerType: 'PICPAY',
    eventId,
    eventType: 'TransactionUpdateMessage',
    status: input.status,
    payload: {
      type: 'TransactionUpdateMessage',
      eventDate: input.at.toISOString(),
      data: { status: input.status, merchantChargeId: input.merchantChargeId },
    },
    receivedAt: input.at,
  });
}

/**
 * Conciliación MANUAL (autoConfirmSettlement apagado): el crédito real queda RESERVADO para el
 * comprobante y el pago espera la aprobación humana (sigue UNVERIFIED, sin abono).
 */
export function reserveForReview(
  ctx: TenantContext,
  receipt: Receipt,
  credit: IncomingCredit,
  at: Date,
): void {
  credit.row.consumedByPaymentId = receipt.payment.id;
  event(
    ctx,
    receipt,
    'settlement_match_pending_review',
    {
      sourceId: credit.row.sourceId,
      creditAmountMinor: credit.row.amountMinor,
    },
    at,
    0,
  );
  recordAssessment(
    ctx,
    receipt,
    'PHASE2_SETTLEMENT',
    'PENDING_REVIEW',
    null,
    [
      `Crédito real conciliado (SOURCE_ID ${credit.row.sourceId}); espera aprobación manual`,
    ],
    at,
  );
}

/** Conciliación AUTOMÁTICA: el crédito real confirma el pago y se abona en el acto. */
export function confirmBySettlement(
  ctx: TenantContext,
  receipt: Receipt,
  credit: IncomingCredit,
  at: Date,
): void {
  credit.row.consumedByPaymentId = receipt.payment.id;
  const amount = credit.row.amountMinor;
  Object.assign(receipt.payment, {
    status: 'VERIFIED',
    amountMinor: amount,
    bankStatus: 'CONFIRMED',
    bankResponse: { via: 'settlement_report', sourceId: credit.row.sourceId },
    verifiedAt: at,
    lastReconciliationAt: at,
  });
  const applied = applyAllocations(
    ctx,
    receipt.credit,
    receipt.payment.id,
    amount,
    at,
  );
  if (applied.settled) receipt.credit.row.status = 'SETTLED';
  event(
    ctx,
    receipt,
    'payment_confirmed_by_settlement',
    { creditId: receipt.credit.id, sourceId: credit.row.sourceId },
    at,
    0,
  );
  event(
    ctx,
    receipt,
    'payment_allocated',
    {
      creditId: receipt.credit.id,
      allocations: applied.splits.map(allocationView),
    },
    at,
    1,
  );
  if (applied.settled)
    event(
      ctx,
      receipt,
      'credit_settled',
      { creditId: receipt.credit.id },
      at,
      2,
    );
  routeToBox(ctx, receipt, amount, after(at, 0), null);
  recordAssessment(
    ctx,
    receipt,
    'PHASE2_SETTLEMENT',
    'CONFIRMED',
    null,
    [`Crédito real conciliado (SOURCE_ID ${credit.row.sourceId})`],
    at,
  );
  chatOut(ctx, {
    phone: receipt.credit.borrower.phone,
    channelId: receipt.channelId,
    body: applied.settled
      ? ctx.messages.receipt.confirmedSettled
      : ctx.messages.receipt.confirmed,
    at: after(at, 3),
  });
}

/**
 * Validación MANUAL del coordinador/admin: hace efectivo el abono (con el monto del crédito real
 * reservado, si lo hay) aunque el pipeline lo hubiera marcado; si salda la cartera, el crédito
 * queda SETTLED (como en la API).
 */
export function manualVerify(
  ctx: TenantContext,
  input: {
    receipt: Receipt;
    decidedBy: UserRef;
    reason: string;
    at: Date;
    reserved: IncomingCredit | null;
  },
): void {
  const { receipt, at } = input;
  const previousStatus = receipt.payment.status;
  const amount =
    input.reserved?.row.amountMinor ?? receipt.payment.amountMinor ?? 0;
  const applied = applyAllocations(
    ctx,
    receipt.credit,
    receipt.payment.id,
    amount,
    at,
  );
  Object.assign(receipt.payment, {
    status: 'VERIFIED',
    amountMinor: amount,
    verifiedAt: at,
  });
  routeToBox(ctx, receipt, amount, at, input.decidedBy.id);
  event(
    ctx,
    receipt,
    'manual_verification',
    {
      decidedBy: input.decidedBy.id,
      reason: input.reason,
      amountMinor: amount,
      previousStatus,
      allocations: applied.splits.length,
      settled: applied.settled,
      ...(input.reserved
        ? { settlementSourceId: input.reserved.row.sourceId }
        : {}),
    },
    at,
    1,
  );
  if (applied.settled) {
    event(
      ctx,
      receipt,
      'credit_settled',
      { creditId: receipt.credit.id },
      at,
      2,
    );
  }
  recordAssessment(
    ctx,
    receipt,
    'PHASE2_SETTLEMENT',
    'CONFIRMED',
    null,
    [
      input.reserved
        ? `Aprobación humana con crédito real (SOURCE_ID ${input.reserved.row.sourceId})`
        : `Aprobación humana manual: ${input.reason}`,
    ],
    after(at, 0),
  );
  ctx.audit({
    at,
    actorId: input.decidedBy.id,
    action: 'POST /payments/:paymentId/manual-verification',
    entity: 'payments',
    entityId: receipt.payment.id,
    payload: { reason: input.reason },
  });
  chatOut(ctx, {
    phone: receipt.credit.borrower.phone,
    channelId: receipt.channelId,
    body: ctx.messages.receipt.confirmed,
    at: after(at, 3),
  });
}

/** Comprobante a una llave que no es de ninguna cuenta del tenant: VERIFIED → Tránsito. */
export async function pixToUnknownKey(
  ctx: TenantContext,
  input: {
    credit: CreditState;
    amountMinor: number;
    account: BankAccountRef;
    at: Date;
  },
): Promise<Receipt> {
  return pixVerifiedOnline(ctx, { ...input, receiverPixKey: UNKNOWN_PIX_KEY });
}

// ── Piezas compartidas ──────────────────────────────────────────────────────────────────────

function allocateWithEvents(
  ctx: TenantContext,
  receipt: Receipt,
  amount: number,
  at: Date,
): AppliedPayment {
  const applied = applyAllocations(
    ctx,
    receipt.credit,
    receipt.payment.id,
    amount,
    at,
  );
  event(
    ctx,
    receipt,
    'payment_allocated',
    {
      creditId: receipt.credit.id,
      allocations: applied.splits.map(allocationView),
    },
    at,
    2,
  );
  if (applied.overpaymentMinor > 0) {
    event(
      ctx,
      receipt,
      'overpayment_registered',
      {
        creditId: receipt.credit.id,
        overpaymentMinor: applied.overpaymentMinor,
      },
      at,
      3,
    );
  }
  if (applied.settled) {
    receipt.credit.row.status = 'SETTLED';
    event(
      ctx,
      receipt,
      'credit_settled',
      { creditId: receipt.credit.id },
      at,
      4,
    );
  }
  return applied;
}

/** Ruteo del dinero verificado: caja BANK por llave PIX o, si no se reconoce, Tránsito. */
function routeToBox(
  ctx: TenantContext,
  receipt: Receipt,
  amount: number,
  at: Date,
  createdBy: string | null,
): void {
  const bankBox = [...ctx.boxes.values()].find(
    (b) =>
      b.type === 'BANK' &&
      b.row.active &&
      b.pixKey !== null &&
      b.pixKey === receipt.payment.receiverPixKey,
  );
  const box: BoxState = bankBox ?? ctx.box('transit');
  ctx.ledger.post({
    box,
    direction: 'IN',
    kind: bankBox ? 'PAYMENT_IN' : 'UNIDENTIFIED',
    amountMinor: amount,
    reason: bankBox ? null : UNIDENTIFIED_REASON,
    at,
    createdBy,
    originZoneId: receipt.credit.zone.id,
    refs: { paymentId: receipt.payment.id },
  });
  event(
    ctx,
    receipt,
    bankBox ? 'payment_routed_to_bank_box' : 'payment_routed_unidentified',
    { cashBoxId: box.id, amountMinor: amount },
    at,
    5,
  );
}

function replyAllocated(
  ctx: TenantContext,
  receipt: Receipt,
  amount: number,
  applied: AppliedPayment,
  at: Date,
): void {
  const paid = formatMoneyMinor(amount, ctx.currency);
  const body = applied.settled
    ? ctx.messages.receipt.settled({
        paid,
        overpayment:
          applied.overpaymentMinor > 0
            ? formatMoneyMinor(applied.overpaymentMinor, ctx.currency)
            : null,
      })
    : ctx.messages.receipt.allocated({
        paid,
        installments: applied.splits.length,
        remaining: formatMoneyMinor(balanceOf(receipt.credit), ctx.currency),
      });
  chatOut(ctx, {
    phone: receipt.credit.borrower.phone,
    channelId: receipt.channelId,
    body,
    at: after(at, 4),
  });
}

function recordAssessment(
  ctx: TenantContext,
  receipt: Receipt,
  phase: 'PHASE1_SCREEN' | 'PHASE2_SETTLEMENT',
  status: FraudStatus | 'CONFIRMED' | 'PENDING_REVIEW',
  score: number | null,
  reasons: readonly string[],
  at: Date,
): void {
  ctx.batch.insert(schema.fraudAssessment, {
    tenantId: ctx.tenantId,
    paymentId: receipt.payment.id,
    phase,
    status,
    score,
    reasons: [...reasons],
    createdAt: at,
  });
}

/** Evento append-only del pago; `order` separa en milisegundos los del mismo instante. */
function event(
  ctx: TenantContext,
  receipt: Receipt,
  type: string,
  payload: Record<string, unknown>,
  at: Date,
  order: number,
): void {
  ctx.batch.insert(schema.paymentEvent, {
    tenantId: ctx.tenantId,
    paymentId: receipt.payment.id,
    creditId: receipt.credit.id,
    type,
    payload,
    createdAt: new Date(at.getTime() + order),
  });
}

function allocationView(split: { installmentId: string; amountMinor: number }) {
  return { installmentId: split.installmentId, amountMinor: split.amountMinor };
}

function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Seed: falta el identificador del crédito real');
  return value;
}
