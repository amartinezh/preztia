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
}

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  rechargesEnabled: false,
  manualRoute: false,
  blockOverdueDatesForSales: true,
  blockInterestChange: true,
  commissionPctBaseThousand: 0,
  defaultCreditLimitMinor: 0,
  applyColorByOverdue: false,
};

/** Aplica un parche parcial sobre los ajustes actuales (inmutable; solo campos presentes). */
export function mergeOperationalSettings(
  current: OperationalSettings,
  patch: Partial<OperationalSettings>,
): OperationalSettings {
  return { ...current, ...patch };
}
