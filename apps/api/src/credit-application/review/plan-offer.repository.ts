import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { PlanOfferSnapshot, PlanOfferStore } from '@preztiaos/application';
import type { PlanOfferStatus } from '@preztiaos/domain';
import { withTenantTxFor } from '../../tenancy/unit-of-work';

const OFFER_EVENT = 'PLAN_OFFERED';

/**
 * Adaptador del puerto `PlanOfferStore`: lee/escribe la sub-máquina de oferta sobre
 * `credit_application` bajo RLS. El cambio de sub-estado + sus datos + el evento de auditoría
 * append-only (`credit_application_event`) se escriben en UNA transacción (auditabilidad).
 */
@Injectable()
export class PlanOfferRepository implements PlanOfferStore {
  async loadOfferSnapshot(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<PlanOfferSnapshot | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          status: schema.creditApplication.status,
          planOffer: schema.creditApplication.planOffer,
          applicantPhone: schema.creditApplication.applicantPhone,
          channelId: schema.creditApplication.channelId,
        })
        .from(schema.creditApplication)
        .where(eq(schema.creditApplication.id, input.applicationId))
        .limit(1);
      return row
        ? {
            status: row.status,
            planOffer: row.planOffer,
            applicantPhone: row.applicantPhone,
            channelId: row.channelId,
          }
        : null;
    });
  }

  async markOffered(input: {
    tenantId: string;
    applicationId: string;
    decidedBy: string;
    to: PlanOfferStatus;
    offeredPlanId: string | null;
    offeredPrincipalMinor: number;
    offerExpiresAt: Date;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.creditApplication)
        .set({
          planOffer: input.to,
          offeredPlanId: input.offeredPlanId,
          offeredPrincipalMinor: input.offeredPrincipalMinor,
          offerExpiresAt: input.offerExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.creditApplication.id, input.applicationId));

      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        type: OFFER_EVENT,
        payload: {
          to: input.to,
          offeredPlanId: input.offeredPlanId,
          offeredPrincipalMinor: input.offeredPrincipalMinor,
          offerExpiresAt: input.offerExpiresAt.toISOString(),
          decidedBy: input.decidedBy,
        },
      });
    });
  }
}
