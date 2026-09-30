import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { NotFoundError, type PortfolioInstallment } from '@preztiaos/domain';
import type {
  MigratedCreditStore,
  MigratedPayment,
} from '@preztiaos/application';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { resolveTenantTimeZone } from '../tenant-config/tenant-timezone';
import { applyAllocationsTx } from '../payments/allocation-writer';
import { mapUniqueViolation } from '../shared/persistence-errors';

const AUDIT_ENTITY = 'credit';

/**
 * Adaptador de la CARGA DE CRÉDITOS MIGRADOS: persiste en una sola transacción el crédito (origen
 * MIGRATED), sus cuotas y los abonos históricos (pagos VERIFIED marcados `historical`, repartidos
 * por el mismo escritor de abonos que el resto del sistema) más la auditoría. A propósito NO
 * escribe en el libro de cajas: ni desembolso ni ingresos (ese dinero se movió en el sistema
 * anterior). La regla y el reparto vienen calculados del dominio.
 */
@Injectable()
export class MigratedCreditRepository implements MigratedCreditStore {
  async timeZone(tenantId: string): Promise<string> {
    return withTenantTxFor(tenantId, (tx) =>
      resolveTenantTimeZone(tx, tenantId),
    );
  }

  async save(input: Parameters<MigratedCreditStore['save']>[0]): Promise<void> {
    await mapUniqueViolation(
      () =>
        withTenantTxFor(input.tenantId, async (tx) => {
          await assertBorrowerExists(tx, input.credit.borrowerId);
          const { credit } = input;
          await tx.insert(schema.credit).values({
            id: credit.id,
            tenantId: input.tenantId,
            borrowerId: credit.borrowerId,
            zoneId: credit.zoneId,
            principalMinor: credit.principalMinor,
            interestPct: credit.interestPct,
            installmentsCount: credit.installmentsCount,
            frequency: credit.frequency,
            currency: credit.currency,
            startDate: credit.startDate,
            endDate: credit.endDate,
            status: credit.settled ? 'SETTLED' : 'ACTIVE',
            origin: 'MIGRATED',
            legacyReference: credit.legacyReference,
          });
          await insertInstallments(
            tx,
            input.tenantId,
            credit.id,
            input.installments,
          );
          for (const payment of input.payments) {
            await insertHistoricalPayment(tx, {
              tenantId: input.tenantId,
              creditId: credit.id,
              currency: credit.currency,
              payment,
            });
          }
          await tx.insert(schema.auditLog).values({
            tenantId: input.tenantId,
            actorId: input.migratedBy,
            action: 'MIGRATE credit',
            entity: AUDIT_ENTITY,
            entityId: credit.id,
            payload: {
              legacyReference: credit.legacyReference,
              startDate: credit.startDate,
              principalMinor: credit.principalMinor,
              historicalPayments: input.payments.length,
              historicalPaidMinor: input.payments.reduce(
                (acc, p) => acc + p.amountMinor,
                0,
              ),
            },
          });
        }),
      'Ya existe un crédito migrado con esa referencia del sistema anterior',
      'LEGACY_REFERENCE_TAKEN',
    );
  }
}

async function assertBorrowerExists(tx: Tx, borrowerId: string): Promise<void> {
  const [borrower] = await tx
    .select({ id: schema.borrower.id })
    .from(schema.borrower)
    .where(eq(schema.borrower.id, borrowerId))
    .limit(1);
  if (!borrower) throw new NotFoundError('El cliente no está registrado');
}

async function insertInstallments(
  tx: Tx,
  tenantId: string,
  creditId: string,
  installments: readonly PortfolioInstallment[],
): Promise<void> {
  await tx.insert(schema.installment).values(
    installments.map((i) => ({
      id: i.id,
      tenantId,
      creditId,
      seq: i.seq,
      dueDate: i.dueDate,
      amountDueMinor: i.amountDueMinor,
    })),
  );
}

/** Un abono histórico: pago VERIFIED marcado `historical`, su reparto y su traza (sin libro). */
async function insertHistoricalPayment(
  tx: Tx,
  input: {
    tenantId: string;
    creditId: string;
    currency: string;
    payment: MigratedPayment;
  },
): Promise<void> {
  const [inserted] = await tx
    .insert(schema.payment)
    .values({
      tenantId: input.tenantId,
      creditId: input.creditId,
      payerPhone: '',
      amountMinor: input.payment.amountMinor,
      currency: input.currency,
      paidAt: input.payment.paidAt,
      status: 'VERIFIED',
      historical: true,
    })
    .returning({ id: schema.payment.id });
  await applyAllocationsTx(tx, {
    tenantId: input.tenantId,
    paymentId: inserted.id,
    creditId: input.creditId,
    allocations: input.payment.allocations,
  });
  await tx.insert(schema.paymentEvent).values({
    tenantId: input.tenantId,
    paymentId: inserted.id,
    creditId: input.creditId,
    type: 'historical_payment_migrated',
    payload: {
      amountMinor: input.payment.amountMinor,
      paidAt: input.payment.paidAt.toISOString(),
    },
  });
}
