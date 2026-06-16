import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ActiveOfferSnapshot,
  PlanReplyStore,
} from '@preztiaos/application';
import type { PlanOfferStatus } from '@preztiaos/domain';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
} from '../../tenancy/unit-of-work';

// Sub-estados de oferta en los que el cliente puede responder por WhatsApp.
const ACTIVE_OFFER_STATES: PlanOfferStatus[] = [
  'AWAITING_SELECTION',
  'AWAITING_ACCEPTANCE',
];

/**
 * Adaptador del puerto `PlanReplyStore`: resuelve el tenant desde el phone_number_id del canal
 * (el webhook no trae tenant) y, bajo RLS, lee/sella la respuesta del cliente a la oferta. Cada
 * transición + su evento de auditoría append-only se escriben en una transacción.
 */
@Injectable()
export class PlanReplyRepository implements PlanReplyStore {
  async findActiveOffer(input: {
    channelId: string;
    applicantPhone: string;
  }): Promise<ActiveOfferSnapshot | null> {
    const tenantId = await resolveTenantByWhatsappPhone(input.channelId);
    if (!tenantId) return null;

    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          applicationId: schema.creditApplication.id,
          planOffer: schema.creditApplication.planOffer,
          offeredPrincipalMinor: schema.creditApplication.offeredPrincipalMinor,
          offerExpiresAt: schema.creditApplication.offerExpiresAt,
        })
        .from(schema.creditApplication)
        .where(
          and(
            eq(schema.creditApplication.applicantPhone, input.applicantPhone),
            eq(schema.creditApplication.status, 'IN_REVIEW'),
            inArray(schema.creditApplication.planOffer, ACTIVE_OFFER_STATES),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        tenantId,
        applicationId: row.applicationId,
        planOffer: row.planOffer,
        // Si faltara el capital (no debería en estos estados), 0 hace fallar la proyección (fail-fast).
        offeredPrincipalMinor: row.offeredPrincipalMinor ?? 0,
        offerExpiresAt: row.offerExpiresAt ?? null,
      };
    });
  }

  async recordSelection(input: {
    tenantId: string;
    applicationId: string;
    offeredPlanId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.creditApplication)
        .set({
          planOffer: 'AWAITING_ACCEPTANCE',
          offeredPlanId: input.offeredPlanId,
          updatedAt: new Date(),
        })
        .where(eq(schema.creditApplication.id, input.applicationId));
      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        type: 'PLAN_SELECTED',
        payload: { offeredPlanId: input.offeredPlanId },
      });
    });
  }

  async recordAcceptance(input: {
    tenantId: string;
    applicationId: string;
    acceptedAt: Date;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.creditApplication)
        .set({
          planOffer: 'ACCEPTED',
          clientAcceptedAt: input.acceptedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.creditApplication.id, input.applicationId));
      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        type: 'CLIENT_ACCEPTED',
        payload: { acceptedAt: input.acceptedAt.toISOString() },
      });
    });
  }

  async recordDecline(input: {
    tenantId: string;
    applicationId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.creditApplication)
        .set({ planOffer: 'DECLINED', updatedAt: new Date() })
        .where(eq(schema.creditApplication.id, input.applicationId));
      await tx.insert(schema.creditApplicationEvent).values({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        type: 'CLIENT_DECLINED',
        payload: {},
      });
    });
  }
}
