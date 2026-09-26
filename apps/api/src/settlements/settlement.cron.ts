import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { ConflictError } from '@preztiaos/domain';
import { withPlatformTx } from '../platform/platform-uow';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';
import { SettlementRepository } from './settlement.repository';

// Por corrida, cuántos períodos cierra un tenant a lo sumo: una historia larga se completa en
// varias horas sin bloquear a los demás tenants.
const MAX_CLOSES_PER_RUN = 12;
// Códigos que significan "no hay nada más que cerrar ahora" (no son fallos).
const DONE_CODES = new Set(['PERIOD_NOT_ENDED', 'NOTHING_TO_SETTLE']);

/**
 * CIERRE AUTOMÁTICO de liquidaciones. Cada hora cierra, por tenant con `settlementAutoClose`, los
 * períodos que ya terminaron (en su zona horaria). Resiliente: el fallo de un tenant no detiene a
 * los demás. La idempotencia la garantizan el candado por tenant y el índice único del período.
 */
@Injectable()
export class SettlementCron {
  private readonly logger = new Logger('Settlements:Cron');

  constructor(private readonly settlements: SettlementRepository) {}

  @Cron(CronExpression.EVERY_HOUR)
  async closeEndedPeriods(): Promise<void> {
    for (const tenantId of await this.autoCloseTenants()) {
      try {
        const closed = await this.closeForTenant(tenantId);
        if (closed > 0)
          this.logger.log(`tenant=${tenantId} períodos cerrados=${closed}`);
      } catch (err) {
        this.logger.error(
          `Falló el cierre de liquidación del tenant ${tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async closeForTenant(tenantId: string): Promise<number> {
    const currency = await resolveTenantCurrency(tenantId);
    for (let closed = 0; closed < MAX_CLOSES_PER_RUN; closed++) {
      try {
        await this.settlements.close({
          tenantId,
          currency,
          closedBy: null,
          now: new Date(),
        });
      } catch (err) {
        if (err instanceof ConflictError && DONE_CODES.has(err.code ?? ''))
          return closed;
        throw err;
      }
    }
    return MAX_CLOSES_PER_RUN;
  }

  /**
   * Tenants que pueden cerrar solos (regla `canAutoClose`): cierre automático activo (por defecto)
   * y fecha de inicio definida — sin ella no se sella historia que nadie pidió. Cross-tenant.
   */
  private async autoCloseTenants(): Promise<string[]> {
    return withPlatformTx(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT c.tenant_id
        FROM tenant_config c
        WHERE COALESCE((c.operational_settings->>'settlementAutoClose')::boolean, true)
          AND NULLIF(c.operational_settings->>'settlementStartDate', '') IS NOT NULL
      `)) as unknown as Array<{ tenant_id: string }>;
      return rows.map((r) => r.tenant_id);
    });
  }
}
