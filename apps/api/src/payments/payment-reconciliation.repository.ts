import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type ActiveCreditPortfolio,
  type BankVerificationResult,
  type PaymentAuditEvent,
  type PendingPayment,
  type ReconciliationRepository,
} from '@preztiaos/application';
import { type AllocationResult, type PixReceiptData } from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto ReconciliationRepository: persistencia de la conciliación
 * batch bajo RLS. `applyVerification` es idempotente: solo transiciona pagos que
 * siguen UNVERIFIED (un pago ya verificado no se re-abona).
 */
@Injectable()
export class PaymentReconciliationDrizzleRepository implements ReconciliationRepository {
  async listUnverified(input: {
    tenantId: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: readonly PendingPayment[]; nextCursor: string | null }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const conditions = [eq(schema.payment.status, 'UNVERIFIED' as const)];
      if (input.cursor) conditions.push(gt(schema.payment.id, input.cursor));

      const rows = await tx
        .select()
        .from(schema.payment)
        .where(and(...conditions))
        .orderBy(asc(schema.payment.id))
        .limit(input.limit);

      const items = rows.map((row: typeof schema.payment.$inferSelect) => ({
        id: row.id,
        creditId: row.creditId,
        channelId: row.channelId,
        payerPhone: row.payerPhone,
        pix: toPix(row),
        reconciliationAttempts: row.reconciliationAttempts,
      }));
      return {
        items,
        nextCursor:
          rows.length === input.limit ? rows[rows.length - 1].id : null,
      };
    });
  }

  async loadPortfolio(input: {
    tenantId: string;
    creditId: string;
  }): Promise<ActiveCreditPortfolio | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [creditRow] = await tx
        .select({ id: schema.credit.id, currency: schema.credit.currency })
        .from(schema.credit)
        .where(
          and(
            eq(schema.credit.id, input.creditId),
            eq(schema.credit.status, 'ACTIVE'),
          ),
        );
      if (!creditRow) return null;

      const rows = await tx
        .select()
        .from(schema.installment)
        .where(eq(schema.installment.creditId, creditRow.id))
        .orderBy(asc(schema.installment.seq));
      return {
        creditId: creditRow.id,
        currency: creditRow.currency,
        installments: rows.map(
          (row: typeof schema.installment.$inferSelect) => ({
            id: row.id,
            seq: row.seq,
            dueDate: row.dueDate,
            amountDueMinor: row.amountDueMinor,
            paidMinor: row.paidMinor,
            status: row.status,
          }),
        ),
      };
    });
  }

  async applyVerification(input: {
    tenantId: string;
    paymentId: string;
    bankResult: BankVerificationResult;
    allocation: AllocationResult;
    events: readonly PaymentAuditEvent[];
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Idempotencia: solo se verifica un pago que SIGUE pendiente.
      const transitioned = await tx
        .update(schema.payment)
        .set({
          status: 'VERIFIED',
          bankStatus: 'CONFIRMED',
          bankResponse: input.bankResult.rawResponse ?? null,
          verifiedAt: new Date(),
          lastReconciliationAt: new Date(),
        })
        .where(
          and(
            eq(schema.payment.id, input.paymentId),
            eq(schema.payment.status, 'UNVERIFIED'),
          ),
        )
        .returning({
          id: schema.payment.id,
          creditId: schema.payment.creditId,
        });
      if (!transitioned.length) return; // otro proceso ya lo verificó

      const creditId = transitioned[0].creditId;
      for (const allocation of input.allocation.allocations) {
        const updated = await tx
          .update(schema.installment)
          .set({
            paidMinor: sql`${schema.installment.paidMinor} + ${allocation.amountMinor}`,
            status: sql`case when ${schema.installment.paidMinor} + ${allocation.amountMinor} >= ${schema.installment.amountDueMinor} then 'PAID'::installment_status else 'PARTIALLY_PAID'::installment_status end`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.installment.id, allocation.installmentId),
              sql`${schema.installment.paidMinor} + ${allocation.amountMinor} <= ${schema.installment.amountDueMinor}`,
            ),
          )
          .returning({ id: schema.installment.id });
        if (!updated.length) {
          throw new Error(
            `Conciliación rechazada: la cuota ${allocation.installmentId} ya no admite el monto`,
          );
        }
      }

      if (input.allocation.allocations.length) {
        await tx.insert(schema.paymentAllocation).values(
          input.allocation.allocations.map((a) => ({
            tenantId: input.tenantId,
            paymentId: input.paymentId,
            installmentId: a.installmentId,
            amountMinor: a.amountMinor,
          })),
        );
      }

      if (input.allocation.creditSettled && creditId) {
        await tx
          .update(schema.credit)
          .set({ status: 'SETTLED' })
          .where(eq(schema.credit.id, creditId));
      }

      await tx.insert(schema.paymentEvent).values(
        input.events.map((event) => ({
          tenantId: input.tenantId,
          paymentId: input.paymentId,
          creditId,
          type: event.type,
          payload: event.payload ?? null,
        })),
      );
    });
  }

  async keepPending(input: {
    tenantId: string;
    paymentId: string;
    countAttempt: boolean;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.payment)
        .set({
          lastReconciliationAt: new Date(),
          ...(input.countAttempt
            ? {
                reconciliationAttempts: sql`${schema.payment.reconciliationAttempts} + 1`,
              }
            : {}),
        })
        .where(eq(schema.payment.id, input.paymentId));
    });
  }

  async flagSuspectedFraud(input: {
    tenantId: string;
    paymentId: string;
    reasons: readonly string[];
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const flagged = await tx
        .update(schema.payment)
        .set({
          status: 'REJECTED_FRAUD',
          bankStatus: 'NOT_FOUND',
          lastReconciliationAt: new Date(),
        })
        .where(
          and(
            eq(schema.payment.id, input.paymentId),
            eq(schema.payment.status, 'UNVERIFIED'),
          ),
        )
        .returning({ creditId: schema.payment.creditId });
      if (!flagged.length) return;

      await tx.insert(schema.paymentEvent).values({
        tenantId: input.tenantId,
        paymentId: input.paymentId,
        creditId: flagged[0].creditId,
        type: 'payment_flagged_suspected_fraud',
        payload: { reasons: [...input.reasons] },
      });
    });
  }
}

function toPix(row: typeof schema.payment.$inferSelect): PixReceiptData {
  return {
    amountMinor: row.amountMinor,
    currency: row.currency,
    paidAt: row.paidAt?.toISOString() ?? null,
    payerName: row.payerName,
    payerTaxId: row.payerTaxId,
    payerBankName: row.payerBankName,
    receiverName: null,
    receiverPixKey: row.receiverPixKey,
    endToEndId: row.endToEndId,
    txid: row.txid,
    raw: (row.extractionRaw as Record<string, unknown> | null) ?? {},
  };
}
