import { randomUUID } from 'node:crypto';
import { schema } from '@preztiaos/db';
import {
  assertCanPost,
  buildAdjustment,
  buildTransfer,
  cashCountResult,
  ledgerAttribution,
  type CashTxDirection,
  type CashTxKind,
  type DebtClosureType,
  type PostingIntent,
} from '@preztiaos/domain';
import type { WriteBatch } from './batch';
import type { BoxState } from './model';

// Libro de cajas del seed: espejo de `cash-out-poster`, `payment-box-router`, `cash-box.repository`
// y `cash-ledger` de la API. Cada asiento pasa por las MISMAS reglas del dominio (`assertCanPost`,
// `buildTransfer`, `buildAdjustment`, `ledgerAttribution`) contra el saldo vigente en memoria, así
// que el seed no puede dejar una caja en negativo ni un asiento sin motivo donde se exige.

/** Trazas al hecho de negocio del asiento (a lo sumo una poblada, como en la API). */
export interface LedgerRefs {
  readonly paymentId?: string;
  readonly creditId?: string;
  readonly expenseId?: string;
  readonly cashCountId?: string;
  readonly settlementPeriodId?: string;
  readonly transferGroupId?: string;
}

export interface PostInput {
  readonly box: BoxState;
  readonly direction: CashTxDirection;
  readonly kind: CashTxKind;
  readonly amountMinor: number;
  readonly reason: string | null;
  readonly at: Date;
  readonly createdBy: string | null;
  /** Zona del hecho de negocio (crédito, gasto); null = la de la caja. */
  readonly originZoneId?: string | null;
  /** Cobrador del hecho (quien pidió el gasto o cobra la comisión); null = dueño de la caja. */
  readonly originCollectorId?: string | null;
  readonly refs?: LedgerRefs;
  readonly debtClosureType?: DebtClosureType | null;
}

/** Movimiento de una caja reducido a lo que importa para la rendición del cobrador. */
export interface LedgerMovement {
  readonly direction: CashTxDirection;
  readonly kind: CashTxKind;
  readonly amountMinor: number;
  readonly at: Date;
}

export class Ledger {
  /** Asientos posteados en la corrida (para la verificación final). */
  postings = 0;
  /** Historia de movimientos por caja, en orden de posteo (= orden de `created_at`). */
  readonly history = new Map<string, LedgerMovement[]>();

  constructor(
    private readonly tenantId: string,
    private readonly batch: WriteBatch,
  ) {}

  /** Postea UN asiento validado por el dominio y actualiza el saldo en memoria. */
  post(input: PostInput): string {
    if (!input.box.row.active) {
      throw new Error(
        `La caja "${input.box.name}" está inactiva: no admite asientos`,
      );
    }
    const intent: PostingIntent = {
      direction: input.direction,
      kind: input.kind,
      amountMinor: input.amountMinor,
      reason: input.reason,
    };
    // Un IN nunca depende del saldo (solo suma), igual que en la API.
    assertCanPost({
      type: input.box.type,
      currentBalanceMinor: input.direction === 'OUT' ? input.box.balance : 0,
      intent,
    });
    const { zoneId, collectorId } = ledgerAttribution({
      originZoneId: input.originZoneId ?? null,
      originCollectorId: input.originCollectorId ?? null,
      box: { zoneId: input.box.zoneId, assignedTo: input.box.assignedTo },
    });
    const id = randomUUID();
    this.batch.insert(schema.cashTransaction, {
      id,
      tenantId: this.tenantId,
      cashBoxId: input.box.id,
      direction: input.direction,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: input.box.currency,
      reason: input.reason,
      paymentId: input.refs?.paymentId ?? null,
      expenseId: input.refs?.expenseId ?? null,
      creditId: input.refs?.creditId ?? null,
      cashCountId: input.refs?.cashCountId ?? null,
      settlementPeriodId: input.refs?.settlementPeriodId ?? null,
      transferGroupId: input.refs?.transferGroupId ?? null,
      zoneId,
      collectorId,
      debtClosureType: input.debtClosureType ?? null,
      createdBy: input.createdBy,
      createdAt: input.at,
    });
    input.box.balance +=
      input.direction === 'IN' ? input.amountMinor : -input.amountMinor;
    const movements = this.history.get(input.box.id) ?? [];
    movements.push({
      direction: input.direction,
      kind: input.kind,
      amountMinor: input.amountMinor,
      at: input.at,
    });
    this.history.set(input.box.id, movements);
    this.postings += 1;
    return id;
  }

  /** Transferencia entre dos cajas: dos patas balanceadas (Σ = 0), cada una con su atribución. */
  transfer(input: {
    from: BoxState;
    to: BoxState;
    amountMinor: number;
    reason: string;
    at: Date;
    createdBy: string;
  }): string {
    if (input.from.id === input.to.id)
      throw new Error('Transferencia a la misma caja');
    if (input.from.currency !== input.to.currency) {
      throw new Error('No se transfiere entre cajas de distinta moneda');
    }
    const legs = buildTransfer({
      amountMinor: input.amountMinor,
      reason: input.reason,
    });
    const transferGroupId = randomUUID();
    for (const [box, leg] of [
      [input.from, legs.out],
      [input.to, legs.in],
    ] as const) {
      this.post({
        box,
        direction: leg.direction,
        kind: leg.kind,
        amountMinor: leg.amountMinor,
        reason: leg.reason,
        at: input.at,
        createdBy: input.createdBy,
        refs: { transferGroupId },
      });
    }
    return transferGroupId;
  }

  /**
   * Arqueo (conteo físico vs. sistema) y, si se pide, el AJUSTE que sella su descuadre en el mismo
   * instante (el saldo no cambió entre ambos, como exige la API). Devuelve el id del arqueo.
   */
  count(input: {
    box: BoxState;
    countedMinor: number;
    notes: string | null;
    performedBy: string;
    at: Date;
    adjust?: { reason: string; at: Date };
  }): string {
    const systemMinor = input.box.balance;
    const result = cashCountResult(systemMinor, input.countedMinor);
    const id = randomUUID();
    this.batch.insert(schema.cashCount, {
      id,
      tenantId: this.tenantId,
      cashBoxId: input.box.id,
      systemMinor,
      countedMinor: input.countedMinor,
      differenceMinor: result.differenceMinor,
      notes: input.notes,
      performedBy: input.performedBy,
      createdAt: input.at,
    });
    if (input.adjust) {
      const intent = buildAdjustment({
        systemMinor,
        targetMinor: input.countedMinor,
        reason: input.adjust.reason,
      });
      this.post({
        box: input.box,
        direction: intent.direction,
        kind: intent.kind,
        amountMinor: intent.amountMinor,
        reason: intent.reason,
        at: input.adjust.at,
        createdBy: input.performedBy,
        refs: { cashCountId: id },
      });
    }
    return id;
  }
}
