import type { DueCreditsReader } from "./ports";
import type { SendCollectionReminderHandler } from "./send-collection-reminder";

/** Conteo del resultado de una corrida de cobranza de un tenant (para logs/observabilidad). */
export interface TenantReminderRunResult {
  readonly total: number;
  readonly sent: number;
  readonly skipped: number;
}

/**
 * Caso de uso: corre la cobranza automática de UN tenant. Lista los créditos con cuota a hoy y
 * despacha un recordatorio por cada uno reutilizando el envío individual. Es RESILIENTE: el fallo
 * de un cliente (sin teléfono, error de red) no aborta el lote; se cuenta como omitido y continúa.
 * El cron de infraestructura decide QUÉ tenants corren y CUÁNDO; aquí solo está el QUÉ se hace.
 */
export class RunTenantCollectionRemindersHandler {
  constructor(
    private readonly dueCredits: DueCreditsReader,
    private readonly reminder: SendCollectionReminderHandler,
  ) {}

  async run(tenantId: string): Promise<TenantReminderRunResult> {
    const targets = await this.dueCredits.listDue(tenantId);
    let sent = 0;
    let skipped = 0;
    for (const target of targets) {
      try {
        const result = await this.reminder.sendToTarget(tenantId, target);
        if (result.sent) sent += 1;
        else skipped += 1;
      } catch {
        skipped += 1; // resiliencia: un fallo individual no detiene el cobro del resto
      }
    }
    return { total: targets.length, sent, skipped };
  }
}
