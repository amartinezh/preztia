import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { assertCanPost, type CashTxKind } from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';
import { balanceOfBox } from './cash-ledger';
import { guardDomain } from './domain-guard';

/** Traza al hecho de negocio que origina la salida (a lo sumo una poblada). */
export interface CashOutOrigin {
  readonly creditId?: string;
  readonly expenseId?: string;
}

export interface CashOutToPost {
  readonly tenantId: string;
  readonly cashBoxId: string;
  /** Naturaleza de la salida (DISBURSEMENT, EXPENSE, WITHDRAWAL…). */
  readonly kind: CashTxKind;
  readonly amountMinor: number;
  readonly reason: string;
  /** app_user que provocó la salida; queda en el asiento. */
  readonly createdBy: string | null;
  readonly origin?: CashOutOrigin;
}

/**
 * Postea UNA salida de dinero (OUT) al libro de una caja/cuenta, DENTRO de la transacción que la
 * origina (atómico con el hecho de negocio: crédito, gasto…). Punto ÚNICO de control de las salidas:
 * bloquea la caja (advisory lock) para serializar saldo↔asiento, valida el invariante de dominio
 * (una salida no deja el saldo negativo) y registra el asiento append-only. Devuelve su id.
 *
 * El invariante de saldo lo enuncia el dominio (`assertCanPost`): si no alcanza, lanza y la
 * transacción completa se revierte (sin doble efecto, sin sobregiro). La idempotencia por origen
 * la garantizan los índices únicos parciales (`cash_tx_credit_idx`, `cash_tx_expense_idx`).
 */
export async function postCashOut(
  tx: Tx,
  input: CashOutToPost,
): Promise<string> {
  // Serializa el par (leer saldo → postear) por caja, igual que el resto de asientos.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${input.cashBoxId}))`,
  );

  const [box] = await tx
    .select({
      id: schema.cashBox.id,
      type: schema.cashBox.type,
      currency: schema.cashBox.currency,
      active: schema.cashBox.active,
    })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.id, input.cashBoxId))
    .limit(1);
  if (!box) throw new NotFoundException('Caja/cuenta de origen no encontrada');
  if (!box.active)
    throw new ConflictException('La caja/cuenta de origen está inactiva');

  const currentBalanceMinor = await balanceOfBox(tx, box.id);
  guardDomain(() =>
    assertCanPost({
      type: box.type,
      currentBalanceMinor,
      intent: {
        direction: 'OUT',
        kind: input.kind,
        amountMinor: input.amountMinor,
        reason: input.reason,
      },
    }),
  );

  const [posted] = await tx
    .insert(schema.cashTransaction)
    .values({
      tenantId: input.tenantId,
      cashBoxId: box.id,
      direction: 'OUT',
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: box.currency,
      reason: input.reason,
      creditId: input.origin?.creditId ?? null,
      expenseId: input.origin?.expenseId ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: schema.cashTransaction.id });

  return posted.id;
}
