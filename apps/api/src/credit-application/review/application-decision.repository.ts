import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ApplicationDecisionSnapshot,
  ApplicationDecisionStore,
  GrantedCreditData,
} from '@preztiaos/application';
import type { ScheduledInstallment } from '@preztiaos/application';
import { withTenantTxFor, type Tx } from '../../tenancy/unit-of-work';
import { postCashOut } from '../../cash/cash-out-poster';

const DECISION_EVENT = 'MANUAL_REVIEW_DECISION';

/**
 * Adaptador del puerto `ApplicationDecisionStore`: persiste la decisión manual del
 * coordinador bajo RLS. La aprobación con otorgamiento (estado del expediente + evento de
 * auditoría append-only + crédito con cronograma y contacto) y el rechazo se escriben en
 * UNA sola transacción (integridad financiera: no queda APPROVED sin crédito ni al revés).
 */
@Injectable()
export class ApplicationDecisionRepository implements ApplicationDecisionStore {
  async loadDecisionSnapshot(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<ApplicationDecisionSnapshot | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          status: schema.creditApplication.status,
          applicantPhone: schema.creditApplication.applicantPhone,
          planOffer: schema.creditApplication.planOffer,
          offeredPlanId: schema.creditApplication.offeredPlanId,
          offeredPrincipalMinor: schema.creditApplication.offeredPrincipalMinor,
        })
        .from(schema.creditApplication)
        .where(eq(schema.creditApplication.id, input.applicationId))
        .limit(1);
      return row
        ? {
            status: row.status,
            applicantPhone: row.applicantPhone,
            planOffer: row.planOffer,
            offeredPlanId: row.offeredPlanId,
            offeredPrincipalMinor: row.offeredPrincipalMinor,
          }
        : null;
    });
  }

  async approveAndGrant(input: {
    tenantId: string;
    applicationId: string;
    reason: string;
    decidedBy: string;
    credit: GrantedCreditData;
    schedule: readonly ScheduledInstallment[];
    fundingCashBoxId: string;
    contact?: { phone: string };
    override?: boolean;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await this.transition(tx, input.applicationId, 'APPROVED');
      await this.audit(tx, {
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        decision: 'APPROVE',
        reason: input.reason,
        decidedBy: input.decidedBy,
        creditId: input.credit.id,
        ...(input.override ? { override: true } : {}),
        ...(input.credit.paymentPlanId
          ? { paymentPlanId: input.credit.paymentPlanId }
          : {}),
      });
      await this.persistCredit(tx, input.credit, input.schedule, input.contact);
      // El dinero SALE de la caja/cuenta origen en la misma transacción: el crédito nace fondeado
      // y el libro refleja el efectivo/banco real. Si el saldo no alcanza, todo se revierte.
      await postCashOut(tx, {
        tenantId: input.tenantId,
        cashBoxId: input.fundingCashBoxId,
        kind: 'DISBURSEMENT',
        amountMinor: input.credit.principalMinor,
        reason: 'Desembolso de crédito',
        createdBy: input.decidedBy,
        origin: { creditId: input.credit.id },
      });
    });
  }

  async reject(input: {
    tenantId: string;
    applicationId: string;
    reason: string;
    decidedBy: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await this.transition(tx, input.applicationId, 'REJECTED');
      await this.audit(tx, {
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        decision: 'REJECT',
        reason: input.reason,
        decidedBy: input.decidedBy,
      });
      // Histórico de rechazos (gestión + retroalimentación con motivo obligatorio).
      await tx.insert(schema.creditApplicationRejection).values({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        reason: input.reason,
        decidedBy: input.decidedBy,
      });
    });
  }

  private async transition(
    tx: Tx,
    applicationId: string,
    status: 'APPROVED' | 'REJECTED',
  ): Promise<void> {
    await tx
      .update(schema.creditApplication)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.creditApplication.id, applicationId));
  }

  private async audit(
    tx: Tx,
    input: {
      tenantId: string;
      applicationId: string;
      decision: 'APPROVE' | 'REJECT';
      reason: string;
      decidedBy: string;
      creditId?: string;
      override?: boolean;
      paymentPlanId?: string;
    },
  ): Promise<void> {
    await tx.insert(schema.creditApplicationEvent).values({
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      type: DECISION_EVENT,
      payload: {
        decision: input.decision,
        reason: input.reason,
        decidedBy: input.decidedBy,
        ...(input.creditId ? { creditId: input.creditId } : {}),
        ...(input.override ? { override: true } : {}),
        ...(input.paymentPlanId ? { paymentPlanId: input.paymentPlanId } : {}),
      },
    });
  }

  // Persiste el crédito + su cartera de cuotas + el contacto del deudor (mismo mapeo que el
  // slice de crédito), dentro de la transacción de la aprobación.
  private async persistCredit(
    tx: Tx,
    credit: GrantedCreditData,
    schedule: readonly ScheduledInstallment[],
    contact?: { phone: string },
  ): Promise<void> {
    await tx.insert(schema.credit).values({
      id: credit.id,
      tenantId: credit.tenantId,
      borrowerId: credit.borrowerId,
      zoneId: credit.zoneId,
      ...(credit.paymentPlanId ? { paymentPlanId: credit.paymentPlanId } : {}),
      principalMinor: credit.principalMinor,
      interestPct: credit.interestPct,
      installmentsCount: credit.installmentsCount,
      frequency: credit.frequency,
      currency: credit.currency,
      startDate: credit.startDate,
      endDate: credit.endDate,
    });

    await tx.insert(schema.installment).values(
      schedule.map((i) => ({
        tenantId: credit.tenantId,
        creditId: credit.id,
        seq: i.seq,
        dueDate: i.dueDate,
        amountDueMinor: i.amountDueMinor,
      })),
    );

    if (contact) {
      await tx
        .insert(schema.borrowerContact)
        .values({
          tenantId: credit.tenantId,
          borrowerId: credit.borrowerId,
          phone: contact.phone,
        })
        .onConflictDoUpdate({
          target: [
            schema.borrowerContact.tenantId,
            schema.borrowerContact.phone,
          ],
          set: { borrowerId: credit.borrowerId },
        });
    }
  }
}
