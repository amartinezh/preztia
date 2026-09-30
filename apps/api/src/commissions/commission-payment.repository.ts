import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  assertCanPayCommissionFrom,
  type SettlementSnapshot,
} from '@preztiaos/domain';
import type { CommissionPaymentStore } from '@preztiaos/application';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { postCashOut } from '../cash/cash-out-poster';
import { mapUniqueViolation } from '../shared/persistence-errors';

const AUDIT_ENTITY = 'settlement-period';

/**
 * Adaptador del pago de comisiones. Lo causado se lee de la FOTO sellada de la liquidación (nunca se
 * recalcula); el pago es un asiento COMMISSION del libro que liga a la liquidación y se atribuye al
 * cobrador y a su zona. Una comisión se paga una sola vez: lo garantiza el índice único
 * `cash_tx_commission_idx` (409 `COMMISSION_ALREADY_PAID`), también ante dos pagos simultáneos.
 */
@Injectable()
export class CommissionPaymentRepository implements CommissionPaymentStore {
  async loadDue(input: {
    tenantId: string;
    settlementId: string;
    collectorId: string;
  }) {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ snapshot: schema.settlementPeriod.snapshot })
        .from(schema.settlementPeriod)
        .where(eq(schema.settlementPeriod.id, input.settlementId))
        .limit(1);
      const line = (
        row?.snapshot as SettlementSnapshot | undefined
      )?.collectors.find((c) => c.collectorId === input.collectorId);
      if (!line) return null;
      return {
        // Fotos anteriores a las comisiones no traen la línea: no hay nada causado.
        amountMinor: line.commission?.amountMinor ?? 0,
        collectorZoneId: line.zoneId ?? null,
        collectorZonePath: line.zonePath,
      };
    });
  }

  async pay(input: {
    tenantId: string;
    settlementId: string;
    collectorId: string;
    collectorZoneId: string | null;
    collectorZonePath: string | null;
    cashBoxId: string;
    amountMinor: number;
    paidBy: string;
  }): Promise<{ cashTransactionId: string }> {
    return mapUniqueViolation(
      () =>
        withTenantTxFor(input.tenantId, async (tx) => {
          assertCanPayCommissionFrom({
            collectorId: input.collectorId,
            collectorZonePath: input.collectorZonePath,
            box: await payingBox(tx, input.cashBoxId),
          });
          const period = await periodLabel(tx, input.settlementId);
          const cashTransactionId = await postCashOut(tx, {
            tenantId: input.tenantId,
            cashBoxId: input.cashBoxId,
            kind: 'COMMISSION',
            amountMinor: input.amountMinor,
            reason: `Comisión del cobrador, liquidación ${period}`,
            createdBy: input.paidBy,
            origin: {
              commission: {
                settlementPeriodId: input.settlementId,
                collectorId: input.collectorId,
                zoneId: input.collectorZoneId,
              },
            },
          });
          await tx.insert(schema.auditLog).values({
            tenantId: input.tenantId,
            actorId: input.paidBy,
            action: 'PAY collector-commission',
            entity: AUDIT_ENTITY,
            entityId: input.settlementId,
            payload: {
              collectorId: input.collectorId,
              cashBoxId: input.cashBoxId,
              amountMinor: input.amountMinor,
              cashTransactionId,
            },
          });
          return { cashTransactionId };
        }),
      'La comisión de este cobrador en esta liquidación ya fue pagada',
      'COMMISSION_ALREADY_PAID',
    );
  }
}

/** Dueño y zona de la caja pagadora (lo que necesita la regla `assertCanPayCommissionFrom`). */
async function payingBox(
  tx: Tx,
  cashBoxId: string,
): Promise<{ assignedTo: string | null; zonePath: string | null }> {
  const [box] = await tx
    .select({
      assignedTo: schema.cashBox.assignedTo,
      zonePath: schema.zone.path,
    })
    .from(schema.cashBox)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.cashBox.zoneId))
    .where(eq(schema.cashBox.id, cashBoxId))
    .limit(1);
  if (!box) throw new NotFoundException('Caja/cuenta pagadora no encontrada');
  return { assignedTo: box.assignedTo, zonePath: box.zonePath ?? null };
}

async function periodLabel(tx: Tx, settlementId: string): Promise<string> {
  const [row] = await tx
    .select({
      start: schema.settlementPeriod.periodStart,
      end: schema.settlementPeriod.periodEnd,
    })
    .from(schema.settlementPeriod)
    .where(eq(schema.settlementPeriod.id, settlementId))
    .limit(1);
  return row ? `${row.start} → ${row.end}` : settlementId;
}
