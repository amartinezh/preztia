import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type Tx } from '../tenancy/unit-of-work';

// Nombre de la caja de tránsito autoaprovisionada (una por tenant).
const TRANSIT_BOX_NAME = 'Fondos en Tránsito';

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

  const [posted] = await tx
    .insert(schema.cashTransaction)
    .values({
      tenantId: input.tenantId,
      cashBoxId: target.cashBoxId,
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
