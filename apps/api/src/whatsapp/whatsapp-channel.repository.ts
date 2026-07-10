import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { NotFoundError } from '@preztiaos/domain';
import { schema } from '@preztiaos/db';
import type { WhatsappChannel } from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { mapUniqueViolation } from '../shared/persistence-errors';
import {
  toCredentialColumns,
  type CredentialInput,
} from './whatsapp-credential-columns';

/**
 * Adaptador de `whatsapp_channel` (número → zona + credenciales de Meta) bajo el rol `app` + RLS. El
 * zone_path se denormaliza desde la zona elegida para estampar/scopear rápido. Los secretos van
 * CIFRADOS en reposo y NUNCA se devuelven: `list` solo informa si existen (`has*`).
 */
@Injectable()
export class WhatsappChannelRepository {
  async list(tenantId: string): Promise<WhatsappChannel[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.whatsappChannel)
        .orderBy(desc(schema.whatsappChannel.createdAt));
      return rows.map((r) => ({
        id: r.id,
        phoneNumberId: r.phoneNumberId,
        zoneId: r.zoneId,
        zonePath: r.zonePath,
        graphVersion: r.graphVersion,
        hasAccessToken: !!r.accessToken,
        hasAppSecret: !!r.appSecret,
        hasVerifyToken: !!r.verifyTokenSha256,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async create(input: {
    tenantId: string;
    phoneNumberId: string;
    zoneId: string;
    accessToken?: string;
    appSecret?: string;
    verifyToken?: string;
    graphVersion?: string;
  }): Promise<{ id: string }> {
    const credentials = toCredentialColumns(input);
    return mapUniqueViolation(
      () =>
        withTenantTxFor(input.tenantId, async (tx) => {
          const [zone] = await tx
            .select({ path: schema.zone.path })
            .from(schema.zone)
            .where(eq(schema.zone.id, input.zoneId))
            .limit(1);
          if (!zone) throw new NotFoundError('La zona no existe');
          const [created] = await tx
            .insert(schema.whatsappChannel)
            .values({
              tenantId: input.tenantId,
              phoneNumberId: input.phoneNumberId,
              zoneId: input.zoneId,
              zonePath: zone.path,
              ...credentials,
            })
            .returning({ id: schema.whatsappChannel.id });
          return { id: created.id };
        }),
      'Ese número de WhatsApp ya está vinculado a una zona',
    );
  }

  /** Actualiza SOLO las credenciales presentes en el parche. `true` si el canal existe. */
  async updateCredentials(input: {
    tenantId: string;
    id: string;
    credentials: CredentialInput;
  }): Promise<boolean> {
    const cols = toCredentialColumns(input.credentials);
    if (Object.keys(cols).length === 0) {
      // Nada que actualizar: confirmar únicamente que el canal existe.
      return withTenantTxFor(input.tenantId, async (tx) => {
        const [row] = await tx
          .select({ id: schema.whatsappChannel.id })
          .from(schema.whatsappChannel)
          .where(eq(schema.whatsappChannel.id, input.id))
          .limit(1);
        return !!row;
      });
    }
    return withTenantTxFor(input.tenantId, async (tx) => {
      const updated = await tx
        .update(schema.whatsappChannel)
        .set(cols)
        .where(eq(schema.whatsappChannel.id, input.id))
        .returning({ id: schema.whatsappChannel.id });
      return updated.length > 0;
    });
  }

  async remove(input: { tenantId: string; id: string }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const deleted = await tx
        .delete(schema.whatsappChannel)
        .where(eq(schema.whatsappChannel.id, input.id))
        .returning({ id: schema.whatsappChannel.id });
      return deleted.length > 0;
    });
  }
}
