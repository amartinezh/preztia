import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { ApplicantLocationStore } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

const ACTIVE_STATUSES = ['AWAITING_DOCUMENTS', 'IN_REVIEW'] as const;

/**
 * Adaptador del puerto ApplicantLocationStore: persiste la geolocalización compartida por WhatsApp
 * en la solicitud ACTIVA del solicitante, bajo el rol `app` + RLS. Solo actualiza solicitudes en
 * curso (no toca expedientes ya aprobados/rechazados). Devuelve si encontró una a la cual aplicarla.
 */
@Injectable()
export class ApplicantLocationRepository implements ApplicantLocationStore {
  async saveActiveApplicationLocation(input: {
    tenantId: string;
    applicant: string;
    latitude: number;
    longitude: number;
  }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const updated = await tx
        .update(schema.creditApplication)
        .set({
          latitude: input.latitude,
          longitude: input.longitude,
          locationSharedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.creditApplication.applicantPhone, input.applicant),
            inArray(schema.creditApplication.status, [...ACTIVE_STATUSES]),
          ),
        )
        .returning({ id: schema.creditApplication.id });
      return updated.length > 0;
    });
  }
}
