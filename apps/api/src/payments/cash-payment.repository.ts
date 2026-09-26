import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  allocatePayment,
  Money,
  portfolioBalanceMinor,
  type PortfolioInstallment,
} from '@preztiaos/domain';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { applyAllocationsTx } from './allocation-writer';
import { postCashPaymentToRouteBox } from '../cash/payment-box-router';

export interface CashPaymentResult {
  id: string;
  creditId: string;
  amountMinor: number;
  balanceMinor: number;
}

/**
 * Registra un abono en EFECTIVO (cobro de ruta) de forma ATÓMICA e IDEMPOTENTE.
 * Reusa el dominio puro `allocatePayment` (cascada a la cuota más antigua) y persiste
 * pago + asignaciones + actualización de cuotas + asiento PAYMENT_IN en la caja de ruta de
 * quien cobró + evento de auditoría en una sola transacción. Devuelve `null` si el crédito
 * no existe.
 */
@Injectable()
export class CashPaymentDrizzleRepository {
  async register(input: CashPaymentInput): Promise<CashPaymentResult | null> {
    return withTenantTxFor(input.tenantId, (tx) =>
      registerCashPaymentTx(tx, input),
    );
  }
}

export interface CashPaymentInput {
  tenantId: string;
  creditId: string;
  amountMinor: number;
  idempotencyKey: string | null;
  /** app_user que recibió el efectivo (su caja de ruta lo recibe). */
  receivedBy: string;
}

/**
 * Cuerpo del registro del abono en efectivo DENTRO de la transacción del llamador: lo reutilizan
 * el endpoint de abono y la liquidación de una parada de ruta (todo o nada con la visita).
 */
export async function registerCashPaymentTx(
  tx: Tx,
  input: CashPaymentInput,
): Promise<CashPaymentResult | null> {
  // 1. Idempotencia: si esta clave ya materializó un abono, devolver su resultado
  //    sin volver a abonar (sin doble cobro).
  if (input.idempotencyKey) {
    const [existing] = await tx
      .select({
        id: schema.payment.id,
        creditId: schema.payment.creditId,
        amountMinor: schema.payment.amountMinor,
      })
      .from(schema.payment)
      .where(eq(schema.payment.idempotencyKey, input.idempotencyKey));
    if (existing) {
      const creditId = existing.creditId ?? input.creditId;
      return {
        id: existing.id,
        creditId,
        amountMinor: existing.amountMinor ?? input.amountMinor,
        balanceMinor: await balanceOf(tx, creditId),
      };
    }
  }

  // 2. Cargar crédito + cuotas.
  const [credit] = await tx
    .select({ id: schema.credit.id, currency: schema.credit.currency })
    .from(schema.credit)
    .where(eq(schema.credit.id, input.creditId));
  if (!credit) return null;

  const installments = await loadInstallments(tx, input.creditId);

  // 3. Regla de dominio: repartir el abono en cascada.
  const result = allocatePayment(
    credit.currency,
    installments,
    Money.of(input.amountMinor, credit.currency),
  );

  // 4. Persistir el pago (efectivo confirmado por el cobrador → VERIFIED).
  const [inserted] = await tx
    .insert(schema.payment)
    .values({
      tenantId: input.tenantId,
      creditId: input.creditId,
      payerPhone: '',
      amountMinor: input.amountMinor,
      currency: credit.currency,
      paidAt: new Date(),
      status: 'VERIFIED',
      idempotencyKey: input.idempotencyKey,
    })
    .returning({ id: schema.payment.id });
  const paymentId = inserted.id;

  // El efectivo entra al libro en la caja de ruta de quien cobró (sin caja → 409, todo
  // se revierte: no queda abono sin dinero en caja).
  await postCashPaymentToRouteBox(tx, {
    tenantId: input.tenantId,
    paymentId,
    receivedBy: input.receivedBy,
    amountMinor: input.amountMinor,
    currency: credit.currency,
  });

  // 5. Aplicar las asignaciones con guardia de concurrencia (paid ≤ due), con su
  //    desglose capital/interés, e insertar las filas auditables de asignación.
  await applyAllocationsTx(tx, {
    tenantId: input.tenantId,
    paymentId,
    creditId: input.creditId,
    allocations: result.allocations,
  });

  // 6. Traza append-only del movimiento de dinero (auditabilidad financiera).
  await tx.insert(schema.paymentEvent).values({
    tenantId: input.tenantId,
    paymentId,
    creditId: input.creditId,
    type: 'cash_payment_registered',
    payload: {
      amountMinor: input.amountMinor,
      allocations: result.allocations.length,
      settled: result.creditSettled,
    },
  });

  return {
    id: paymentId,
    creditId: input.creditId,
    amountMinor: input.amountMinor,
    balanceMinor: portfolioBalanceMinor(result.installments),
  };
}

async function loadInstallments(
  tx: Tx,
  creditId: string,
): Promise<PortfolioInstallment[]> {
  const rows = await tx
    .select()
    .from(schema.installment)
    .where(eq(schema.installment.creditId, creditId))
    .orderBy(asc(schema.installment.seq));
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    dueDate: row.dueDate,
    amountDueMinor: row.amountDueMinor,
    paidMinor: row.paidMinor,
    status: row.status,
  }));
}

async function balanceOf(tx: Tx, creditId: string): Promise<number> {
  return portfolioBalanceMinor(await loadInstallments(tx, creditId));
}
