import { Injectable } from '@nestjs/common';
import { schema } from '@preztiaos/db';
import type { LocationStore, NewLocation } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Adaptador del puerto LocationStore: inserta puntos del recorrido en `collector_location`
// bajo el rol `app` + RLS. Append-only; sin reglas de negocio.
@Injectable()
export class LocationDrizzleRepository implements LocationStore {
  async record(location: NewLocation): Promise<void> {
    await withTenantTxFor(location.tenantId, async (tx) => {
      await tx.insert(schema.collectorLocation).values({
        id: location.id,
        tenantId: location.tenantId,
        collectorId: location.collectorId,
        lat: location.lat,
        lng: location.lng,
      });
    });
  }
}
