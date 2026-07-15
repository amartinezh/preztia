import { Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ApplicantJourneyReader,
  CommittedApplicantContext,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Adaptador del puerto `ApplicantJourneyReader`: decide si un solicitante YA se comprometió con un
 * crédito para que el asistente de conocimiento no le re-ofrezca "iniciar una solicitud". Se
 * considera comprometido cuando su expediente aceptó la oferta (`plan_offer_status = 'ACCEPTED'`) o
 * ya quedó `APPROVED` (el crédito se genera desde el expediente, que persiste en ese estado). Todo
 * bajo RLS del tenant. Si lo está, resuelve el teléfono de atención de la zona del canal.
 */
@Injectable()
export class ApplicantJourneyRepository implements ApplicantJourneyReader {
  async committedContext(input: {
    tenantId: string;
    channelId: string;
    applicantPhone: string;
  }): Promise<CommittedApplicantContext | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [committed] = await tx
        .select({ id: schema.creditApplication.id })
        .from(schema.creditApplication)
        .where(
          and(
            eq(schema.creditApplication.applicantPhone, input.applicantPhone),
            or(
              eq(schema.creditApplication.planOffer, 'ACCEPTED'),
              eq(schema.creditApplication.status, 'APPROVED'),
            ),
          ),
        )
        .limit(1);
      if (!committed) return null;

      // Comprometido: resuelve el teléfono de atención de la zona del canal (número → zona → tel).
      const [channelZone] = await tx
        .select({ supportPhone: schema.zone.supportPhone })
        .from(schema.whatsappChannel)
        .innerJoin(
          schema.zone,
          eq(schema.zone.id, schema.whatsappChannel.zoneId),
        )
        .where(eq(schema.whatsappChannel.phoneNumberId, input.channelId))
        .limit(1);
      return { supportPhone: channelZone?.supportPhone ?? null };
    });
  }
}
