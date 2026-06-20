import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RunTenantCollectionRemindersHandler } from '@preztiaos/application';
import { DueTenantsRepository } from './due-tenants.repository';

/**
 * Disparador AUTOMÁTICO de la cobranza por WhatsApp. Corre cada hora en punto y delega el QUÉ a
 * la capa de aplicación: pregunta qué tenants tienen su hora local de envío AHORA y corre la
 * cobranza de cada uno. Es resiliente — el fallo de un tenant no detiene a los demás — y
 * observable — registra el resultado por tenant. La idempotencia (un envío por crédito y día) la
 * garantiza el caso de uso, no este reloj.
 */
@Injectable()
export class CollectionReminderCron {
  private readonly logger = new Logger('Collections:Cron');

  constructor(
    private readonly dueTenants: DueTenantsRepository,
    private readonly runForTenant: RunTenantCollectionRemindersHandler,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async dispatchDueReminders(): Promise<void> {
    const tenants = await this.dueTenants.listDueNow();
    if (tenants.length === 0) return;
    this.logger.log(
      `Cobranza automática: ${tenants.length} tenant(s) en su hora de envío`,
    );

    for (const tenantId of tenants) {
      try {
        const result = await this.runForTenant.run(tenantId);
        this.logger.log(
          `tenant=${tenantId} total=${result.total} enviados=${result.sent} omitidos=${result.skipped}`,
        );
      } catch (err) {
        this.logger.error(
          `Falló la cobranza del tenant ${tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
