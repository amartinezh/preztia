// Puertos del slice de COBRANZA por WhatsApp. La capa de aplicación los define; la
// infraestructura (Drizzle/WhatsApp) los implementa (inversión de dependencias).

/** Cliente a cobrar hoy, con todo lo que el caso de uso necesita para redactar y enviar. */
export interface CollectionReminderTarget {
  readonly creditId: string;
  readonly firstName: string;
  /** Teléfono del cliente (destinatario, E.164 sin '+'). */
  readonly phone: string;
  /** phone_number_id del canal desde el que se envía (el canal de la zona del crédito). */
  readonly channelId: string;
  /** Cuota a cobrar hoy en unidades menores (entero); el read model la calcula en la zona horaria del tenant. */
  readonly dueMinor: number;
  readonly currency: string;
  /** Llave PIX del tenant para recibir el pago; null si el tenant aún no la configuró. */
  readonly pixKey: string | null;
  /** Fecha de negocio usada como "hoy" (ISO `YYYY-MM-DD`, en la zona horaria del tenant). */
  readonly asOfDate: string;
}

/** Read model de cobranza: traduce cartera → objetivos de cobro a hoy (zona horaria del tenant). */
export interface DueCreditsReader {
  /** Todos los créditos con saldo vencido/vigente a hoy del tenant (para el cron). */
  listDue(tenantId: string): Promise<CollectionReminderTarget[]>;
  /** Un crédito concreto; null si no hay crédito activo o el cliente no tiene teléfono. */
  findDueCredit(input: {
    tenantId: string;
    creditId: string;
  }): Promise<CollectionReminderTarget | null>;
}

/** Resuelve qué tenants deben enviar AHORA según su hora local configurada (cron horario). */
export interface DueTenantsReader {
  listDueNow(): Promise<string[]>;
}

/**
 * Idempotencia del cobro diario: reserva el envío de un crédito para una fecha. Devuelve `false`
 * si ya estaba reservado (reintentos del cron o doble disparo manual no reenvían el mensaje).
 */
export interface ReminderIdempotencyStore {
  claimDailyReminder(input: {
    tenantId: string;
    creditId: string;
    date: string;
  }): Promise<boolean>;
}

export type CollectionReminderTrigger = "MANUAL" | "CRON";

/** Bitácora append-only del envío de un recordatorio (auditabilidad, §3.7). */
export interface CollectionAuditLog {
  recordReminderSent(input: {
    tenantId: string;
    creditId: string;
    actorId: string | null;
    trigger: CollectionReminderTrigger;
    dueMinor: number;
    currency: string;
  }): Promise<void>;
}

/** Resultado de un intento de envío (manual o automático): qué pasó, para auditoría/UI. */
export interface SendReminderResult {
  readonly sent: boolean;
  readonly reason?:
    | "NO_ACTIVE_CREDIT"
    | "NOTHING_DUE"
    | "NO_PIX_KEY"
    | "ALREADY_SENT_TODAY";
  readonly phone?: string;
  readonly dueMinor?: number;
  readonly currency?: string;
  /** Texto exacto enviado (para mostrarlo en la UI tras el envío manual). */
  readonly messagePreview?: string;
}
