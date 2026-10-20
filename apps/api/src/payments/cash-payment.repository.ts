import { Injectable } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  allocatePayment,
  backdatePolicyOf,
  Money,
  portfolioBalanceMinor,
  resolvePaymentDate,
  resolveReceivingBox,
  type PortfolioInstallment,
  type RequestedPaymentDate,
  type ResolvedPaymentDate,
  type Role,
} from '@preztiaos/domain';
import { readOperationalSettingsTx } from '../tenant-config/operational-settings.reader';
import { resolveTenantTimeZone } from '../tenant-config/tenant-timezone';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { applyAllocationsTx, settleCreditTx } from './allocation-writer';
import {
  loadReceivingBoxTx,
  postCashPaymentToRouteBox,
  postPaymentToReceivingBox,
  type ReceivingBoxRef,
} from '../cash/payment-box-router';

export interface CashPaymentResult {
  id: string;
  creditId: string;
  amountMinor: number;
  balanceMinor: number;
}

/**
 * Registra un abono en EFECTIVO (cobro de ruta, o pago en la oficina) de forma ATÓMICA e
 * IDEMPOTENTE. Reusa el dominio puro `allocatePayment` (cascada a la cuota más antigua) y persiste
 * pago + asignaciones + actualización de cuotas + asiento PAYMENT_IN (en la caja de ruta de quien
 * cobró o en la caja de oficina/cuenta elegida) + crédito SETTLED si queda saldado + evento de
 * auditoría en una sola transacción. Devuelve `null` si el crédito no existe.
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
  /**
   * Fecha del pago pedida (captura offline o elegida a mano); ausente = ahora. Solo cambia la fecha
   * del PAGO: el asiento del libro se fecha al registrarse (ADR #41).
   */
  requestedDate?: RequestedPaymentDate | null;
  /** Rol de quien registra: decide si puede elegir la fecha a mano y dónde entra el dinero. */
  actorRole?: Role;
  /**
   * Caja de oficina o cuenta que recibe el dinero cuando registra quien NO es cobrador (ADMIN,
   * COORDINATOR): no tiene caja de ruta. El cobrador no la envía: recibe en su caja de ruta.
   */
  receivingCashBoxId?: string | null;
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

  // 2b. Fecha del pago y caja que recibe (reglas de dominio): antes de mover dinero, para
  //     fallar sin efectos.
  const date = await resolveDateTx(tx, input);
  const chosenBox = await chosenReceivingBoxTx(tx, input, credit.currency);

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
      paidAt: date.paidAt,
      status: 'VERIFIED',
      idempotencyKey: input.idempotencyKey,
    })
    .returning({ id: schema.payment.id });
  const paymentId = inserted.id;

  // El dinero entra al libro en la caja de ruta de quien cobró (sin caja → 409, todo se
  // revierte: no queda abono sin dinero en caja) o, si registra la oficina, en la caja elegida.
  if (chosenBox) {
    await postPaymentToReceivingBox(tx, {
      tenantId: input.tenantId,
      paymentId,
      box: chosenBox,
      amountMinor: input.amountMinor,
      currency: credit.currency,
      createdBy: input.receivedBy,
    });
  } else {
    await postCashPaymentToRouteBox(tx, {
      tenantId: input.tenantId,
      paymentId,
      receivedBy: input.receivedBy,
      amountMinor: input.amountMinor,
      currency: credit.currency,
    });
  }

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
      paidAt: date.paidAt.toISOString(),
      ...(input.requestedDate ? { dateSource: input.requestedDate.kind } : {}),
      ...(chosenBox ? { receivingCashBoxId: chosenBox.id } : {}),
    },
  });
  // 7. Cartera saldada ⇒ crédito SETTLED (regla del dominio), en la misma transacción.
  if (result.creditSettled) {
    await settleCreditTx(tx, {
      tenantId: input.tenantId,
      paymentId,
      creditId: input.creditId,
    });
  }
  await auditPaymentDate(tx, { input, paymentId, date });

  return {
    id: paymentId,
    creditId: input.creditId,
    amountMinor: input.amountMinor,
    balanceMinor: portfolioBalanceMinor(result.installments),
  };
}

/**
 * Caja elegida por quien no es cobrador (validada), o null si recibe la caja de ruta de quien
 * cobra. La regla de quién elige es del dominio (`resolveReceivingBox`); sin rol explícito se trata
 * como cobrador (la liquidación de una parada de ruta).
 */
async function chosenReceivingBoxTx(
  tx: Tx,
  input: CashPaymentInput,
  currency: string,
): Promise<ReceivingBoxRef | null> {
  const receiving = resolveReceivingBox({
    actorRole: input.actorRole ?? 'COLLECTOR',
    requestedCashBoxId: input.receivingCashBoxId ?? null,
  });
  if (receiving.kind === 'ROUTE_BOX') return null;
  return loadReceivingBoxTx(tx, {
    cashBoxId: receiving.cashBoxId,
    creditId: input.creditId,
    currency,
  });
}

/** Resuelve la fecha del pago con la política, la zona horaria y el último corte sellado del tenant. */
async function resolveDateTx(
  tx: Tx,
  input: CashPaymentInput,
): Promise<ResolvedPaymentDate> {
  const now = new Date();
  if (!input.requestedDate) {
    return { paidAt: now, backdated: false, adjusted: null };
  }
  const [lastSealed] = await tx
    .select({ endsAt: schema.settlementPeriod.endsAt })
    .from(schema.settlementPeriod)
    .orderBy(desc(schema.settlementPeriod.endsAt))
    .limit(1);
  return resolvePaymentDate(input.requestedDate, {
    policy: backdatePolicyOf(
      await readOperationalSettingsTx(tx, input.tenantId),
    ),
    // Sin rol explícito se trata como cobrador (el más restringido).
    actorRole: input.actorRole ?? 'COLLECTOR',
    now,
    timeZone: await resolveTenantTimeZone(tx, input.tenantId),
    sealedUntil: lastSealed?.endsAt ?? null,
  });
}

/**
 * Auditoría de la fecha: todo pago fechado en el pasado, y toda captura offline registrada con la
 * hora actual por caer fuera de la ventana, queda en `audit_log` (quién, cuándo se registró y qué
 * fecha se pidió).
 */
async function auditPaymentDate(
  tx: Tx,
  args: {
    input: CashPaymentInput;
    paymentId: string;
    date: ResolvedPaymentDate;
  },
): Promise<void> {
  const { input, date } = args;
  if (!input.requestedDate || (!date.backdated && !date.adjusted)) return;
  await tx.insert(schema.auditLog).values({
    tenantId: input.tenantId,
    actorId: input.receivedBy,
    action: date.adjusted ? 'ADJUST payment-date' : 'BACKDATE payment',
    entity: 'payment',
    entityId: args.paymentId,
    payload: {
      source: input.requestedDate.kind,
      requested:
        input.requestedDate.kind === 'OFFLINE_CAPTURE'
          ? input.requestedDate.capturedAt.toISOString()
          : input.requestedDate.paidOn,
      paidAt: date.paidAt.toISOString(),
      registeredAt: new Date().toISOString(),
      adjusted: date.adjusted,
      amountMinor: input.amountMinor,
    },
  });
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
