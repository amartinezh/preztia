import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  assertCanPost,
  assertCanReceivePaymentInto,
  ConflictError,
  NotFoundError,
  type CashBoxType,
} from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';
import { attributionFor, lockCashBox } from './cash-ledger';

// Nombre de la caja de tránsito autoaprovisionada (una por tenant).
const TRANSIT_BOX_NAME = 'Fondos en Tránsito';

// Motivo del asiento de cobro en efectivo (la caja CASH exige motivo en todo movimiento).
const CASH_COLLECTION_REASON = 'Cobro en efectivo en ruta';
// Motivo del abono que registra en la oficina quien no es cobrador (ADMIN/COORDINATOR).
const OFFICE_PAYMENT_REASON = 'Abono registrado en oficina';

export interface VerifiedPaymentToRoute {
  readonly tenantId: string;
  readonly paymentId: string;
  /** Llave PIX receptora extraída del comprobante (puede ser null si ilegible). */
  readonly receiverPixKey: string | null;
  readonly amountMinor: number | null;
  readonly currency: string;
  /** app_user que originó el asiento; null cuando lo postea el sistema (PIX/batch). */
  readonly createdBy: string | null;
}

export interface PaymentRoutingResult {
  readonly kind: 'BANK' | 'TRANSIT';
  readonly cashBoxId: string;
}

/**
 * Rutea un pago YA VERIFICADO a su caja, dentro de la transacción que lo verificó (atómico):
 *  - Si la `receiverPixKey` empareja una cuenta bancaria con caja BANK activa → asiento
 *    PAYMENT_IN en esa caja (vinculación automática del pago, Req 4).
 *  - Si no se puede identificar → asiento UNIDENTIFIED en la caja de TRÁNSITO (se autoprovisiona)
 *    y se deja un evento de auditoría; el saldo de tránsito > 0 es la alerta para el admin.
 *
 * Idempotente: el índice único parcial `cash_tx_payment_idx` (payment_id) garantiza que un
 * pago se rutea a UNA sola caja aunque ambos flujos (recepción y conciliación) lo intenten.
 * Devuelve null si no hay monto que postear o si el pago ya fue ruteado.
 */
export async function routeVerifiedPaymentToBox(
  tx: Tx,
  input: VerifiedPaymentToRoute,
): Promise<PaymentRoutingResult | null> {
  if (!input.amountMinor || input.amountMinor <= 0) return null;

  const bankBoxId = input.receiverPixKey
    ? await findBankBoxByPixKey(tx, input.receiverPixKey)
    : null;

  const target: PaymentRoutingResult = bankBoxId
    ? { kind: 'BANK', cashBoxId: bankBoxId }
    : {
        kind: 'TRANSIT',
        cashBoxId: await ensureTransitBox(tx, input.tenantId, input.currency),
      };

  const { zoneId, collectorId } = await attributionFor(tx, target.cashBoxId, {
    paymentId: input.paymentId,
  });
  const [posted] = await tx
    .insert(schema.cashTransaction)
    .values({
      tenantId: input.tenantId,
      cashBoxId: target.cashBoxId,
      zoneId,
      collectorId,
      direction: 'IN',
      kind: target.kind === 'BANK' ? 'PAYMENT_IN' : 'UNIDENTIFIED',
      amountMinor: input.amountMinor,
      currency: input.currency,
      reason:
        target.kind === 'TRANSIT'
          ? 'Pago no identificado: sin caja bancaria asociada a la llave PIX'
          : null,
      paymentId: input.paymentId,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing()
    .returning({ id: schema.cashTransaction.id });

  // Ya estaba ruteado (idempotencia): no se duplica el asiento ni el evento.
  if (!posted) return null;

  await tx.insert(schema.paymentEvent).values({
    tenantId: input.tenantId,
    paymentId: input.paymentId,
    creditId: null,
    type:
      target.kind === 'BANK'
        ? 'payment_routed_to_bank_box'
        : 'payment_routed_unidentified',
    payload: { cashBoxId: target.cashBoxId, amountMinor: input.amountMinor },
  });

  return target;
}

export interface CashPaymentToPost {
  readonly tenantId: string;
  readonly paymentId: string;
  /** app_user que recibió el efectivo: el dinero queda en SU caja de ruta. */
  readonly receivedBy: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * Postea un cobro en EFECTIVO como PAYMENT_IN en la caja de ruta de quien lo recibió, dentro
 * de la transacción que registra el pago (atómico: no hay abono sin dinero en caja). El
 * efectivo en la calle queda así en el libro y es la base de la rendición del cobrador.
 *
 * Fallo rápido (409 NO_ROUTE_CASH_BOX) si quien cobra no tiene caja de ruta activa en la
 * moneda del pago: sin caja no se puede rendir cuentas, así que no se recibe efectivo.
 * Idempotente por `cash_tx_payment_idx`.
 */
export async function postCashPaymentToRouteBox(
  tx: Tx,
  input: CashPaymentToPost,
): Promise<void> {
  const routeBoxId = await findRouteBox(tx, input.receivedBy, input.currency);
  if (!routeBoxId) {
    throw new ConflictError(
      'No tienes una caja de ruta activa para recibir efectivo',
      'NO_ROUTE_CASH_BOX',
    );
  }
  const intent = {
    direction: 'IN' as const,
    kind: 'PAYMENT_IN' as const,
    amountMinor: input.amountMinor,
    reason: CASH_COLLECTION_REASON,
  };
  // Bajo el candado de la caja: el cobro queda ordenado respecto del corte de la rendición.
  await lockCashBox(tx, routeBoxId);
  // Un IN nunca depende del saldo: solo se validan monto y motivo.
  assertCanPost({ type: 'CASH', currentBalanceMinor: 0, intent });

  const { zoneId, collectorId } = await attributionFor(tx, routeBoxId, {
    paymentId: input.paymentId,
  });
  await tx
    .insert(schema.cashTransaction)
    .values({
      tenantId: input.tenantId,
      cashBoxId: routeBoxId,
      ...intent,
      currency: input.currency,
      paymentId: input.paymentId,
      zoneId,
      collectorId,
      createdBy: input.receivedBy,
    })
    .onConflictDoNothing();
}

/** Caja de oficina o cuenta elegida para recibir un abono, ya validada. */
export interface ReceivingBoxRef {
  readonly id: string;
  readonly type: CashBoxType;
}

/**
 * Carga y valida la caja que eligió quien no es cobrador para recibir el abono de un crédito
 * (regla de dominio `assertCanReceivePaymentInto`): activa, de oficina o bancaria, usable por la
 * zona del crédito y en su moneda. Se llama ANTES de escribir el pago: falla sin efectos.
 */
export async function loadReceivingBoxTx(
  tx: Tx,
  input: { cashBoxId: string; creditId: string; currency: string },
): Promise<ReceivingBoxRef> {
  const [box] = await tx
    .select({
      id: schema.cashBox.id,
      type: schema.cashBox.type,
      assignedTo: schema.cashBox.assignedTo,
      active: schema.cashBox.active,
      currency: schema.cashBox.currency,
      zonePath: schema.zone.path,
    })
    .from(schema.cashBox)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.cashBox.zoneId))
    .where(eq(schema.cashBox.id, input.cashBoxId))
    .limit(1);
  if (!box) throw new NotFoundError('Caja que recibe el dinero no encontrada');
  const [credit] = await tx
    .select({ zonePath: schema.zone.path })
    .from(schema.credit)
    .innerJoin(schema.zone, eq(schema.zone.id, schema.credit.zoneId))
    .where(eq(schema.credit.id, input.creditId))
    .limit(1);
  if (!credit) throw new NotFoundError('Crédito no encontrado');
  assertCanReceivePaymentInto({
    creditZonePath: credit.zonePath,
    box: {
      type: box.type,
      assignedTo: box.assignedTo,
      active: box.active,
      zonePath: box.zonePath ?? null,
    },
  });
  if (box.currency !== input.currency) {
    throw new ConflictError(
      'La caja que recibe el dinero es de otra moneda',
      'RECEIVING_BOX_CURRENCY',
    );
  }
  return { id: box.id, type: box.type };
}

/**
 * Postea el abono registrado en la oficina como PAYMENT_IN en la caja elegida, dentro de la
 * transacción del pago (atómico). Se atribuye a la zona del crédito y a ningún cobrador: no es
 * cobro de ruta (no entra en rendiciones ni en comisiones). Idempotente por `cash_tx_payment_idx`.
 */
export async function postPaymentToReceivingBox(
  tx: Tx,
  input: {
    readonly tenantId: string;
    readonly paymentId: string;
    readonly box: ReceivingBoxRef;
    readonly amountMinor: number;
    readonly currency: string;
    readonly createdBy: string;
  },
): Promise<void> {
  const intent = {
    direction: 'IN' as const,
    kind: 'PAYMENT_IN' as const,
    amountMinor: input.amountMinor,
    reason: OFFICE_PAYMENT_REASON,
  };
  await lockCashBox(tx, input.box.id);
  // Un IN nunca depende del saldo: solo se validan monto y motivo.
  assertCanPost({ type: input.box.type, currentBalanceMinor: 0, intent });
  const { zoneId, collectorId } = await attributionFor(tx, input.box.id, {
    paymentId: input.paymentId,
  });
  await tx
    .insert(schema.cashTransaction)
    .values({
      tenantId: input.tenantId,
      cashBoxId: input.box.id,
      ...intent,
      currency: input.currency,
      paymentId: input.paymentId,
      zoneId,
      collectorId,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing();
}

/**
 * Caja de ruta activa del usuario en la moneda dada (la más antigua si hubiera varias, para
 * que el destino sea determinista). RLS acota el tenant.
 */
export async function findRouteBox(
  tx: Tx,
  userId: string,
  currency: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.cashBox.id })
    .from(schema.cashBox)
    .where(
      and(
        eq(schema.cashBox.assignedTo, userId),
        eq(schema.cashBox.type, 'CASH'),
        eq(schema.cashBox.active, true),
        eq(schema.cashBox.currency, currency),
      ),
    )
    .orderBy(asc(schema.cashBox.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Caja BANK activa cuya cuenta vinculada tiene esta llave PIX receptora (RLS acota el tenant). */
async function findBankBoxByPixKey(
  tx: Tx,
  pixKey: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.cashBox.id })
    .from(schema.cashBox)
    .innerJoin(
      schema.tenantBankAccount,
      eq(schema.tenantBankAccount.id, schema.cashBox.bankAccountId),
    )
    .where(
      and(
        eq(schema.tenantBankAccount.pixKey, pixKey),
        eq(schema.cashBox.type, 'BANK'),
        eq(schema.cashBox.active, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Devuelve la caja de tránsito del tenant, creándola si no existe (una por tenant). */
async function ensureTransitBox(
  tx: Tx,
  tenantId: string,
  currency: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: schema.cashBox.id })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.type, 'TRANSIT'))
    .limit(1);
  if (existing) return existing.id;

  // El índice único `cash_box_one_transit_idx` hace segura la creación concurrente.
  await tx
    .insert(schema.cashBox)
    .values({ tenantId, type: 'TRANSIT', name: TRANSIT_BOX_NAME, currency })
    .onConflictDoNothing();

  const [created] = await tx
    .select({ id: schema.cashBox.id })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.type, 'TRANSIT'))
    .limit(1);
  return created.id;
}
