import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Lee el toggle `autoConfirmSettlement` de los ajustes operativos del tenant (bajo RLS). Gobierna
 * si un match de settlement se hace efectivo automáticamente (true) o queda RESERVADO para
 * aprobación humana (false = default). Lectura mínima: solo el toggle, sin arrastrar el resto de
 * la configuración ni acoplar el slice de config.
 */
@Injectable()
export class SettlementReviewSettingsReader {
  async autoConfirm(tenantId: string): Promise<boolean> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ settings: schema.tenantConfig.operationalSettings })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId))
        .limit(1);
      // Ausente o fila sin la clave (config previa a la feature) → false (revisión manual).
      return row?.settings?.autoConfirmSettlement ?? false;
    });
  }
}
