// Ajustes operativos del tenant (configuración de cobro del legado). Tipo canónico + valores por
// defecto + mezcla pura de un parche parcial. El esquema de BD refleja esta forma (mirror).

export interface OperationalSettings {
  readonly rechargesEnabled: boolean;
  readonly manualRoute: boolean;
  readonly blockOverdueDatesForSales: boolean;
  readonly blockInterestChange: boolean;
  /** Comisión en base-mil (200 = 20%), igual que el interés. */
  readonly commissionPctBaseThousand: number;
  /** Cupo por defecto al crear un cliente (unidades menores). */
  readonly defaultCreditLimitMinor: number;
  readonly applyColorByOverdue: boolean;
  /**
   * Negociación de planes por WhatsApp (Fase 10). Si está activo, al ofertar (botón azul) se envía
   * el menú de planes activos y se espera que el cliente elija; si no, se toma el plan por defecto.
   */
  readonly clientChoosesPlan: boolean;
  /**
   * Vencimiento de la oferta de plan en horas (default 24 = 1 día). Pasado el plazo, la respuesta
   * del cliente se ignora y debe re-ofertarse o aplicarse el override del administrador.
   */
  readonly planOfferTtlHours: number;
  /**
   * Si está activo, ADMIN/COORDINATOR pueden crear el crédito aunque el cliente no haya aceptado por
   * WhatsApp (override). Si está inactivo, la creación exige la aceptación del cliente.
   */
  readonly allowAdminOverride: boolean;
}

/** Vencimiento por defecto de la oferta de plan: un día (parametrizable por tenant). */
export const DEFAULT_PLAN_OFFER_TTL_HOURS = 24;

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  rechargesEnabled: false,
  manualRoute: false,
  blockOverdueDatesForSales: true,
  blockInterestChange: true,
  commissionPctBaseThousand: 0,
  defaultCreditLimitMinor: 0,
  applyColorByOverdue: false,
  clientChoosesPlan: false,
  planOfferTtlHours: DEFAULT_PLAN_OFFER_TTL_HOURS,
  allowAdminOverride: true,
};

/** Aplica un parche parcial sobre los ajustes actuales (inmutable; solo campos presentes). */
export function mergeOperationalSettings(
  current: OperationalSettings,
  patch: Partial<OperationalSettings>,
): OperationalSettings {
  return { ...current, ...patch };
}
