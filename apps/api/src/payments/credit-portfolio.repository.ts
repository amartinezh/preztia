import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type ActiveCreditPortfolio,
  type CreditPortfolioRepository,
  type PaymentOutcome,
} from '@preztiaos/application';
import { type PaymentAllocation } from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { routeVerifiedPaymentToBox } from '../cash/payment-box-router';
import {
  phase1Status,
  recordFraudAssessmentTx,
} from './fraud-assessment.recorder';

/**
 * Adaptador del puerto CreditPortfolioRepository: traduce cartera/pagos ↔
 * persistencia (Drizzle) bajo RLS. `savePaymentOutcome` es UNA transacción con
 * dos garantías de integridad financiera:
 *  - Idempotencia: un `end_to_end_id` PIX repetido no inserta ni re-abona
 *    (unique parcial + ON CONFLICT DO NOTHING).
 *  - Sin doble abono concurrente: el incremento de `paid_minor` es atómico y
 *    está acotado por `amount_due_minor`; si otra operación ya abonó la cuota,
 *    la transacción falla en vez de corromper el saldo.
 */
@Injectable()
export class CreditPortfolioDrizzleRepository implements CreditPortfolioRepository {
  private readonly logger = new Logger('Payments:Portfolio');

  async findActiveByPhone(input: {
    tenantId: string;
    phone: string;
  }): Promise<ActiveCreditPortfolio | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [contact] = await tx
        .select({ borrowerId: schema.borrowerContact.borrowerId })
        .from(schema.borrowerContact)
        .where(eq(schema.borrowerContact.phone, input.phone));
      if (!contact) return null;

      const [creditRow] = await tx
        .select({ id: schema.credit.id, currency: schema.credit.currency })
        .from(schema.credit)
        .where(
          and(
            eq(schema.credit.borrowerId, contact.borrowerId),
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

  async savePaymentOutcome(outcome: PaymentOutcome): Promise<void> {
    const p = outcome.payment;
    await withTenantTxFor(p.tenantId, async (tx) => {
      const [inserted] = await tx
        .insert(schema.payment)
        .values({
          tenantId: p.tenantId,
          creditId: p.creditId,
          providerMessageId: p.providerMessageId,
          channelId: p.channelId,
          payerPhone: p.payerPhone,
          amountMinor: p.amountMinor,
          currency: p.currency,
          paidAt: p.paidAt ? new Date(p.paidAt) : null,
          payerName: p.payerName,
          payerTaxId: p.payerTaxId,
          payerBankName: p.payerBankName,
          receiverPixKey: p.receiverPixKey,
          endToEndId: p.endToEndId,
          txid: p.txid,
          extractionRaw: p.extractionRaw,
          sha256: p.sha256,
          storageKey: p.storageKey,
          mimeType: p.mimeType,
          status: p.status,
          bankStatus: p.bankStatus,
          bankResponse: p.bankResponse ?? null,
          verifiedAt: p.status === 'VERIFIED' ? new Date() : null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.payment.id });

      // Mismo end_to_end_id ya registrado: no-op idempotente, solo se audita.
      if (!inserted) {
        this.logger.warn(
          'Pago PIX duplicado ignorado (end_to_end_id ya registrado)',
        );
        await tx.insert(schema.paymentEvent).values({
          tenantId: p.tenantId,
          paymentId: null,
          creditId: p.creditId,
          type: 'payment_duplicate_ignored',
          payload: { providerMessageId: p.providerMessageId },
        });
        return;
      }

      const paymentId = inserted.id;

      // Traza antifraude de la Fase 1 (señales del pre-screen), en la misma transacción.
      await recordFraudAssessmentTx(tx, {
        tenantId: p.tenantId,
        paymentId,
        phase: 'PHASE1_SCREEN',
        status: phase1Status(p.status, p.fraudReasons),
        score: p.fraudScore,
        reasons: p.fraudReasons ?? [],
      });

      await this.applyAllocations(
        tx,
        p.tenantId,
        paymentId,
        outcome.allocations,
      );

      if (outcome.creditSettled && p.creditId) {
        await tx
          .update(schema.credit)
          .set({ status: 'SETTLED' })
          .where(eq(schema.credit.id, p.creditId));
      }

      await tx.insert(schema.paymentEvent).values(
        outcome.events.map((event) => ({
          tenantId: p.tenantId,
          paymentId,
          creditId: p.creditId,
          type: event.type,
          payload: event.payload ?? null,
        })),
      );

      // El dinero confirmado entra a su caja (bancaria por llave PIX, o tránsito si no se
      // identifica). Solo cuando el pago queda VERIFIED: un UNVERIFIED aún no es dinero en caja.
      if (p.status === 'VERIFIED') {
        await routeVerifiedPaymentToBox(tx, {
          tenantId: p.tenantId,
          paymentId,
          receiverPixKey: p.receiverPixKey,
          amountMinor: p.amountMinor,
          currency: p.currency,
          createdBy: null,
        });
      }
    });
  }

  /**
   * Aplica los abonos con incrementos atómicos acotados: si otra operación ya
   * abonó la cuota por encima de lo esperado, la condición no matchea y la
   * transacción completa se revierte (nunca un saldo corrupto en silencio).
   */
  private async applyAllocations(
    tx: Tx,
    tenantId: string,
    paymentId: string,
    allocations: readonly PaymentAllocation[],
  ): Promise<void> {
    for (const allocation of allocations) {
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
          `Abono rechazado: la cuota ${allocation.installmentId} ya no admite el monto (operación concurrente)`,
        );
      }
    }

    if (allocations.length) {
      await tx.insert(schema.paymentAllocation).values(
        allocations.map((a) => ({
          tenantId,
          paymentId,
          installmentId: a.installmentId,
          amountMinor: a.amountMinor,
        })),
      );
    }
  }
}
