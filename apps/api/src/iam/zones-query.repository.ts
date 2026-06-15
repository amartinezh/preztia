import { Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { ZoneNode } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Read model del árbol de zonas: devuelve todas las zonas del tenant (ordenadas por path)
// con sus coordinadores. Dos consultas + un mapa evitan el N+1 al agregar coordinadores.
@Injectable()
export class ZonesQueryRepository {
  async listZones(input: { tenantId: string }): Promise<ZoneNode[]> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const zones = await tx
        .select()
        .from(schema.zone)
        .orderBy(asc(schema.zone.path));
      const coordinators = await tx
        .select({
          zoneId: schema.zoneCoordinator.zoneId,
          coordinatorId: schema.zoneCoordinator.coordinatorId,
        })
        .from(schema.zoneCoordinator);

      const byZone = new Map<string, string[]>();
      for (const row of coordinators) {
        const list = byZone.get(row.zoneId) ?? [];
        list.push(row.coordinatorId);
        byZone.set(row.zoneId, list);
      }

      return zones.map((zone) => ({
        id: zone.id,
        parentZoneId: zone.parentZoneId,
        path: zone.path,
        name: zone.name,
        coordinatorIds: byZone.get(zone.id) ?? [],
        createdAt: zone.createdAt.toISOString(),
      }));
    });
  }
}
