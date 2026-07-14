import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ExpenseRecord,
  ExpenseStore,
  NewExpense,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { postCashOut } from './cash-out-poster';

// Adaptador del puerto ExpenseStore: opera `expense` bajo el rol `app` + RLS. Sin reglas.
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
      });
    });
  }

  async findById(input: {
    tenantId: string;
    expenseId: string;
  }): Promise<ExpenseRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.expense)
        .where(eq(schema.expense.id, input.expenseId))
        .limit(1);
      return row ? toRecord(row) : null;
    });
  }

  async updateReview(input: {
    tenantId: string;
    expenseId: string;
    status: ExpenseRecord['status'];
    reviewedBy: string;
    reviewedAt: Date;
    paidFromCashBoxId?: string;
  }): Promise<ExpenseRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.expense)
        .set({
          status: input.status,
          reviewedBy: input.reviewedBy,
          reviewedAt: input.reviewedAt,
        })
        .where(eq(schema.expense.id, input.expenseId))
        .returning();
      if (!row) return null;

      // El gasto aprobado SALE de la caja/cuenta pagadora en la misma transacción: si el saldo no
      // alcanza, todo se revierte (sin gasto aprobado sin egreso; sin sobregiro).
      if (input.status === 'APPROVED' && input.paidFromCashBoxId) {
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

      return toRecord(row);
    });
  }
}

function toRecord(row: typeof schema.expense.$inferSelect): ExpenseRecord {
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    description: row.description,
    amountMinor: row.amountMinor,
    status: row.status,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
