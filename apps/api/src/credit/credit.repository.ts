import {
  CreditRepository,
  DisbursementFunding,
  ScheduledInstallment,
} from '@preztiaos/application';
import { ScheduleFrequency } from '@preztiaos/domain';
import { schema } from '@preztiaos/db';
import { withTenantTx } from '../tenancy/unit-of-work';
import { postCashOut } from '../cash/cash-out-poster';

// Motivo del asiento de desembolso de un otorgamiento directo.
const DIRECT_DISBURSEMENT_REASON =
  'Desembolso de crédito (otorgamiento directo)';

export class CreditDrizzleRepository implements CreditRepository {
  async save(
    c: {
      id: string;
      tenantId: string;
      borrowerId: string;
      zoneId: string;
      paymentPlanId?: string | null;
      principalMinor: number;
      interestPct: number;
      installmentsCount: number;
      frequency: ScheduleFrequency;
      currency: string;
      startDate: string;
      endDate: string;
    },
    installments: readonly ScheduledInstallment[],
    funding: DisbursementFunding,
    contact?: { phone: string },
  ): Promise<void> {
    await withTenantTx(async (tx) => {
      await tx.insert(schema.credit).values({
        id: c.id,
        tenantId: c.tenantId,
        borrowerId: c.borrowerId,
        zoneId: c.zoneId,
        paymentPlanId: c.paymentPlanId ?? null,
        principalMinor: c.principalMinor,
        interestPct: c.interestPct,
        installmentsCount: c.installmentsCount,
        frequency: c.frequency,
        currency: c.currency,
        startDate: c.startDate,
        endDate: c.endDate,
      });

      // Cartera: una fila por cuota del cronograma calculado en dominio.
      await tx.insert(schema.installment).values(
        installments.map((i) => ({
          tenantId: c.tenantId,
          creditId: c.id,
          seq: i.seq,
          dueDate: i.dueDate,
          amountDueMinor: i.amountDueMinor,
        })),
      );

      // El dinero SALE de la caja/cuenta origen en la misma transacción: el crédito nace
      // fondeado. Sin saldo, o si la zona del crédito no puede usar la caja, todo se revierte.
      await postCashOut(tx, {
        tenantId: c.tenantId,
        cashBoxId: funding.cashBoxId,
        kind: 'DISBURSEMENT',
        amountMinor: c.principalMinor,
        reason: DIRECT_DISBURSEMENT_REASON,
        createdBy: funding.grantedBy,
        origin: { creditId: c.id },
      });

      // Vínculo deudor ↔ teléfono: permite abonar los pagos PIX que lleguen por
      // WhatsApp. Si el teléfono ya existía, se reasigna al deudor actual.
      if (contact) {
        await tx
          .insert(schema.borrowerContact)
          .values({
            tenantId: c.tenantId,
            borrowerId: c.borrowerId,
            phone: contact.phone,
          })
          .onConflictDoUpdate({
            target: [
              schema.borrowerContact.tenantId,
              schema.borrowerContact.phone,
            ],
            set: { borrowerId: c.borrowerId },
          });
      }
    });
  }
}
