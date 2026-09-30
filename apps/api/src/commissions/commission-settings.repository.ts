import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  isWithinScope,
  resolveCommissionPolicy,
  type CommissionPolicy,
  type EffectiveCommissionPolicy,
} from '@preztiaos/domain';
import type { ZoneCommissionStore } from '@preztiaos/application';
import type { CommissionSettingsView } from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { readCommissionConfig } from '../settlements/settlement-inputs.reader';

const AUDIT_ENTITY = 'zone';

/**
 * Adaptador de la configuración de comisiones por zona (`zone.commission_*`). Lee y escribe bajo RLS;
 * la herencia, el tope y la validación son del dominio (`cash/commission.ts`). Todo cambio queda en
 * `audit_log` con el antes y el después, en la misma transacción.
 */
@Injectable()
export class CommissionSettingsRepository implements ZoneCommissionStore {
  async loadZone(input: { tenantId: string; zoneId: string }) {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const zone = await zoneById(tx, input.zoneId);
      if (!zone) return null;
      const config = await readCommissionConfig(tx, input.tenantId);
      return { path: zone.path, capPerMille: config.capPerMille };
    });
  }

  async saveZonePolicy(input: {
    tenantId: string;
    zoneId: string;
    policy: CommissionPolicy | null;
    actorId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const before = await zoneById(tx, input.zoneId);
      await tx
        .update(schema.zone)
        .set({
          commissionRatePerMille: input.policy?.ratePerMille ?? null,
          commissionBase: input.policy?.base ?? null,
        })
        .where(eq(schema.zone.id, input.zoneId));
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: input.policy ? 'SET zone-commission' : 'CLEAR zone-commission',
        entity: AUDIT_ENTITY,
        entityId: input.zoneId,
        payload: { before: before?.own ?? null, after: input.policy },
      });
    });
  }

  /**
   * Vista de la configuración: defecto, tope y, por cada zona al alcance (el ADMIN, todas), su
   * política propia y la efectiva (heredada o recortada por el tope), en orden de árbol.
   */
  async view(input: {
    tenantId: string;
    scopes: readonly string[] | null;
  }): Promise<CommissionSettingsView> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const config = await readCommissionConfig(tx, input.tenantId);
      const rows = await tx
        .select({
          zoneId: schema.zone.id,
          parentZoneId: schema.zone.parentZoneId,
          name: schema.zone.name,
          path: schema.zone.path,
          rate: schema.zone.commissionRatePerMille,
          base: schema.zone.commissionBase,
        })
        .from(schema.zone)
        .orderBy(asc(schema.zone.path));
      const names = new Map(rows.map((z) => [z.zoneId, z.name]));
      const visible = rows.filter(
        (z) => input.scopes === null || isWithinScope(z.path, input.scopes),
      );
      return {
        enabled: config.enabled,
        tenantDefault: config.tenantDefault,
        capPerMille: config.capPerMille,
        zones: visible.map((z) => ({
          zoneId: z.zoneId,
          parentZoneId: z.parentZoneId,
          name: z.name,
          path: z.path,
          own: ownPolicy(z.rate, z.base),
          effective: withSourceName(
            resolveCommissionPolicy(z.path, config),
            names,
          ),
        })),
      };
    });
  }
}

/** La política efectiva con el nombre de la zona de la que se hereda (puede ser un ancestro). */
function withSourceName(
  effective: EffectiveCommissionPolicy,
  names: ReadonlyMap<string, string>,
) {
  return {
    ...effective,
    sourceZoneName: effective.sourceZoneId
      ? (names.get(effective.sourceZoneId) ?? null)
      : null,
  };
}

function ownPolicy(
  rate: number | null,
  base: CommissionPolicy['base'] | null,
): CommissionPolicy | null {
  return rate === null || base === null ? null : { ratePerMille: rate, base };
}

async function zoneById(
  tx: Tx,
  zoneId: string,
): Promise<{ path: string; own: CommissionPolicy | null } | null> {
  const [zone] = await tx
    .select({
      path: schema.zone.path,
      rate: schema.zone.commissionRatePerMille,
      base: schema.zone.commissionBase,
    })
    .from(schema.zone)
    .where(eq(schema.zone.id, zoneId))
    .limit(1);
  return zone
    ? { path: zone.path, own: ownPolicy(zone.rate, zone.base) }
    : null;
}
