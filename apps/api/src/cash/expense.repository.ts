import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { assertCanPayExpenseFrom } from '@preztiaos/domain';
import type {
  ExpenseRecord,
  ExpenseStore,
  NewExpense,
} from '@preztiaos/application';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { postCashOut } from './cash-out-poster';

// Adaptador del puerto ExpenseStore: opera `expense` bajo el rol `app` + RLS. Las reglas (qué caja
// puede pagar) las decide el dominio; aquí solo se leen los datos que necesita.
@Injectable()
export class ExpenseDrizzleRepository implements ExpenseStore {
  async create(expense: NewExpense): Promise<void> {
    await withTenantTxFor(expense.tenantId, async (tx) => {
      await tx.insert(schema.expense).values({
        id: expense.id,
        tenantId: expense.tenantId,
        requestedBy: expense.requestedBy,
        description: expense.description,
        amountMinor: expense.amountMinor,
        zoneId: await requesterZoneId(tx, expense.requestedBy),
        receiptStorageKey: expense.receipt.storageKey,
        receiptMimeType: expense.receipt.mimeType,
        receiptSha256: expense.receipt.sha256,
      });
    });
  }

  async findById(input: {
    tenantId: string;
    expenseId: string;
  }): Promise<ExpenseRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ expense: schema.expense, zonePath: schema.zone.path })
        .from(schema.expense)
        .leftJoin(schema.zone, eq(schema.zone.id, schema.expense.zoneId))
        .where(eq(schema.expense.id, input.expenseId))
        .limit(1);
      return row ? toRecord(row.expense, row.zonePath) : null;
    });
  }

  async updateReview(input: {
    tenantId: string;
    expenseId: string;
    status: ExpenseRecord['status'];
    reviewedBy: string;
    reviewedAt: Date;
    rejectionReason: string | null;
    paidFromCashBoxId?: string;
  }): Promise<ExpenseRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.expense)
        .set({
          status: input.status,
          reviewedBy: input.reviewedBy,
          reviewedAt: input.reviewedAt,
          rejectionReason: input.rejectionReason,
          paidFromCashBoxId: input.paidFromCashBoxId ?? null,
        })
        .where(eq(schema.expense.id, input.expenseId))
        .returning();
      if (!row) return null;

      // El gasto aprobado SALE de la caja/cuenta pagadora en la misma transacción: si el saldo no
      // alcanza, todo se revierte (sin gasto aprobado sin egreso; sin sobregiro).
      const zonePath = await zonePathOf(tx, row.zoneId);
      if (input.status === 'APPROVED' && input.paidFromCashBoxId) {
        assertCanPayExpenseFrom({
          requestedBy: row.requestedBy,
          expenseZonePath: zonePath,
          box: await payingBox(tx, input.paidFromCashBoxId),
        });
        await postCashOut(tx, {
          tenantId: input.tenantId,
          cashBoxId: input.paidFromCashBoxId,
          kind: 'EXPENSE',
          amountMinor: row.amountMinor,
          reason: row.description,
          createdBy: input.reviewedBy,
          origin: { expenseId: row.id },
        });
      }

      return toRecord(row, zonePath);
    });
  }
}

/**
 * Zona del gasto = la de la caja de ruta de quien lo pide (la más antigua si hubiera varias, para
 * que sea determinista). NULL si no tiene caja de ruta: el gasto es del tenant.
 */
async function requesterZoneId(
  tx: Tx,
  requestedBy: string,
): Promise<string | null> {
  const [box] = await tx
    .select({ zoneId: schema.cashBox.zoneId })
    .from(schema.cashBox)
    .where(
      and(
        eq(schema.cashBox.assignedTo, requestedBy),
        eq(schema.cashBox.active, true),
        isNotNull(schema.cashBox.zoneId),
      ),
    )
    .orderBy(asc(schema.cashBox.createdAt))
    .limit(1);
  return box?.zoneId ?? null;
}

async function zonePathOf(
  tx: Tx,
  zoneId: string | null,
): Promise<string | null> {
  if (!zoneId) return null;
  const [zone] = await tx
    .select({ path: schema.zone.path })
    .from(schema.zone)
    .where(eq(schema.zone.id, zoneId))
    .limit(1);
  return zone?.path ?? null;
}

/** Dueño y zona de la caja pagadora (lo que necesita la regla `assertCanPayExpenseFrom`). */
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

function toRecord(
  row: typeof schema.expense.$inferSelect,
  zonePath: string | null,
): ExpenseRecord {
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    description: row.description,
    amountMinor: row.amountMinor,
    status: row.status,
    zonePath,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
  };
}
