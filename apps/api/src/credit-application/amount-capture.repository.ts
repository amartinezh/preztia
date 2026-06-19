import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  AmountCaptureStore,
  AwaitingAmountApplication,
} from '@preztiaos/application';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
} from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto `AmountCaptureStore`: resuelve el tenant desde el phone_number_id del canal
 * (el webhook no trae tenant) y, bajo RLS, lee/sella el monto solicitado en la solicitud activa.
 * "A la espera del monto" = solicitud AWAITING_DOCUMENTS con `requested_amount_minor` aún nulo.
 */
@Injectable()
export class AmountCaptureRepository implements AmountCaptureStore {
  async findAwaitingAmount(input: {
    channelId: string;
    applicant: string;
  }): Promise<AwaitingAmountApplication | null> {
    const tenantId = await resolveTenantByWhatsappPhone(input.channelId);
    if (!tenantId) return null;

    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ applicationId: schema.creditApplication.id })
        .from(schema.creditApplication)
        .where(
          and(
            eq(schema.creditApplication.applicantPhone, input.applicant),
            eq(schema.creditApplication.status, 'AWAITING_DOCUMENTS'),
            isNull(schema.creditApplication.requestedAmountMinor),
          ),
        )
        .limit(1);
      return row ? { tenantId, applicationId: row.applicationId } : null;
    });
  }

  async recordAmount(input: {
    tenantId: string;
    applicationId: string;
    amountMinor: number;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Idempotente: solo escribe si seguía sin monto (no pisa un valor ya capturado).
      await tx
        .update(schema.creditApplication)
        .set({ requestedAmountMinor: input.amountMinor, updatedAt: new Date() })
        .where(
          and(
            eq(schema.creditApplication.id, input.applicationId),
            isNull(schema.creditApplication.requestedAmountMinor),
          ),
        );
    });
  }
}
