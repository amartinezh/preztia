import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { cashCountResult } from '@preztiaos/domain';
import type { CashCountResultView } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { balanceOfBox } from './cash-ledger';
import { guardDomain } from './domain-guard';

/**
 * Arqueo de caja (Req 7): toma el saldo del sistema (Σ asientos) al momento, lo compara con el
 * conteo físico vía la regla pura `cashCountResult` y persiste la bitácora (append-only). El
 * descuadre se reporta tal cual, nunca se enmascara.
 */
@Injectable()
export class CashCountDrizzleRepository {
  async count(input: {
    tenantId: string;
    cashBoxId: string;
    countedMinor: number;
    notes: string | null;
    performedBy: string;
  }): Promise<CashCountResultView> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [box] = await tx
        .select({ id: schema.cashBox.id })
        .from(schema.cashBox)
        .where(eq(schema.cashBox.id, input.cashBoxId))
        .limit(1);
      if (!box) throw new NotFoundException('Caja no encontrada');

      const systemMinor = await balanceOfBox(tx, input.cashBoxId);
      const result = guardDomain(() =>
        cashCountResult(systemMinor, input.countedMinor),
      );

      const [row] = await tx
        .insert(schema.cashCount)
        .values({
          tenantId: input.tenantId,
          cashBoxId: input.cashBoxId,
          systemMinor,
          countedMinor: input.countedMinor,
          differenceMinor: result.differenceMinor,
          notes: input.notes,
          performedBy: input.performedBy,
        })
        .returning();

      return {
        id: row.id,
        cashBoxId: row.cashBoxId,
        systemMinor: row.systemMinor,
        countedMinor: row.countedMinor,
        differenceMinor: row.differenceMinor,
        isBalanced: result.isBalanced,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
