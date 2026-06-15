import { Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { ZoneRecord, ZoneStore } from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { type Tx } from '../tenancy/unit-of-work';

// Adaptador del puerto ZoneStore: árbol de zonas (ltree) bajo RLS. El path se construye en
// el dominio; aquí solo se persiste/consulta. Las subzonas se detectan con el operador de
// descendencia ltree (`<@`) sobre el índice GiST.
@Injectable()
export class ZoneDrizzleRepository implements ZoneStore {
  async create(input: {
    id: string;
    tenantId: string;
    parentZoneId: string | null;
    path: string;
    name: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx.insert(schema.zone).values({
        id: input.id,
        tenantId: input.tenantId,
        parentZoneId: input.parentZoneId,
        path: input.path,
        name: input.name,
      });
    });
  }

  async update(input: {
    tenantId: string;
    zoneId: string;
    name: string;
  }): Promise<ZoneRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.zone)
        .set({ name: input.name })
        .where(eq(schema.zone.id, input.zoneId))
        .returning();
      return row ? toRecord(row) : null;
    });
  }

  async remove(input: {
    tenantId: string;
    zoneId: string;
  }): Promise<{ deleted: boolean; hasChildren: boolean }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const zone = await loadZone(tx, input.zoneId);
      if (!zone) return { deleted: false, hasChildren: false };
      // ¿Tiene descendientes? (cualquier otra zona cuyo path cae bajo este).
      const [childRow] = await tx
        .select({ value: sql<number>`count(*)` })
        .from(schema.zone)
        .where(
          and(
            sql`${schema.zone.path} <@ ${zone.path}::ltree`,
            ne(schema.zone.id, input.zoneId),
          ),
        );
      if (Number(childRow?.value ?? 0) > 0) {
        return { deleted: false, hasChildren: true };
      }
      await tx
        .delete(schema.zoneCoordinator)
        .where(eq(schema.zoneCoordinator.zoneId, input.zoneId));
      await tx.delete(schema.zone).where(eq(schema.zone.id, input.zoneId));
      return { deleted: true, hasChildren: false };
    });
  }

  async findById(input: {
    tenantId: string;
    zoneId: string;
  }): Promise<ZoneRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const zone = await loadZone(tx, input.zoneId);
      return zone ? toRecord(zone) : null;
    });
  }

  async assignCoordinator(input: {
    tenantId: string;
    zoneId: string;
    coordinatorId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Idempotente: sin restricción única en la tabla, evitamos el duplicado a mano.
      const [existing] = await tx
        .select({ zoneId: schema.zoneCoordinator.zoneId })
        .from(schema.zoneCoordinator)
        .where(
          and(
            eq(schema.zoneCoordinator.zoneId, input.zoneId),
            eq(schema.zoneCoordinator.coordinatorId, input.coordinatorId),
          ),
        )
        .limit(1);
      if (existing) return;
      await tx.insert(schema.zoneCoordinator).values({
        tenantId: input.tenantId,
        zoneId: input.zoneId,
        coordinatorId: input.coordinatorId,
      });
    });
  }
}

async function loadZone(
  tx: Tx,
  zoneId: string,
): Promise<typeof schema.zone.$inferSelect | undefined> {
  const [row] = await tx
    .select()
    .from(schema.zone)
    .where(eq(schema.zone.id, zoneId))
    .limit(1);
  return row;
}

function toRecord(row: typeof schema.zone.$inferSelect): ZoneRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    parentZoneId: row.parentZoneId,
    path: row.path,
    name: row.name,
  };
}
