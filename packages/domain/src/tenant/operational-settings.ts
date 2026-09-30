import {
  assertValidSettlementSettings,
  DEFAULT_SETTLEMENT_SETTINGS,
  type SettlementFrequency,
  type SettlementSettings,
} from "../cash/settlement-period";
import {
  assertValidCommissionCap,
  assertValidCommissionPolicy,
  type CommissionBase,
  type CommissionConfig,
  type ZoneCommissionSetting,
} from "../cash/commission";
import type { InterestPolicy } from "../credit/plan/interest-policy";
import type { BackdatePolicy } from "../credit/payment/payment-date";
import { assertValidTimeZone, DEFAULT_TIME_ZONE } from "../shared/business-time";

// Ajustes operativos del tenant (configuración de cobro del legado). Tipo canónico + valores por
// defecto + mezcla pura de un parche parcial. El esquema de BD refleja esta forma (mirror).

export interface OperationalSettings {
  /**
   * Zona horaria IANA de la EMPRESA. Define el "hoy" y los cortes de todo el sistema: liquidación,
   * fecha de los pagos, rendición del cobrador, cartera, recordatorios y créditos migrados.
   */
  readonly timeZone: string;
  readonly rechargesEnabled: boolean;
  readonly manualRoute: boolean;
  /** "Bloquear fechas atrasadas": solo el ADMIN elige a mano una fecha pasada para un pago. */
  readonly blockBackdatedPayments: boolean;
  /** Días de negocio hacia atrás que puede tener la fecha de un pago (0–30; offline y manual). */
  readonly backdateMaxDays: number;
  /** Modo flexible de fechas: se reciben los pagos sin límite de días ni de período sellado. */
  readonly relaxedPaymentDates: boolean;
  /** "Bloquear cambio de interés": el interés de un crédito sale de un plan activo (ver `interest-policy`). */
  readonly blockInterestChange: boolean;
  /** Con el bloqueo encendido, el ADMIN conserva la vía "Personalizado" (interés libre). */
  readonly adminCustomInterestAllowed: boolean;
  /**
   * Comisión POR DEFECTO del cobrador en base-mil (200 = 20%), igual que el interés: aplica a las
   * zonas sin configuración propia (ni heredada). Ver `cash/commission.ts`.
   */
  readonly commissionPctBaseThousand: number;
  /**
   * ¿El tenant paga comisiones a sus cobradores? Lo decide el ADMIN. Apagadas (por defecto), las
   * liquidaciones no causan ninguna; lo ya causado en fotos anteriores sigue pagándose.
   */
  readonly commissionsEnabled: boolean;
  /** Base por defecto de la comisión (lo cobrado, lo rendido o el capital recuperado). */
  readonly commissionBase: CommissionBase;
  /**
   * Tope de comisión que fija el ADMIN (base-mil): ningún coordinador configura una zona por encima
   * y la tasa efectiva nunca lo supera. Con 0 (por defecto) nadie cobra comisión hasta fijarlo.
   */
  readonly commissionMaxPctBaseThousand: number;
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
  /**
   * Conciliación AUTOMÁTICA de pagos por settlement (webhook PicPay / reporte MP). Si está activo,
   * cuando un crédito REAL coincide con un comprobante, el sistema abona la cartera de inmediato
   * (100% seguro = crédito real). Si está inactivo (DEFAULT), el match NO se hace efectivo solo:
   * el crédito queda RESERVADO y el pago pasa a "pendiente de aprobación" para que un humano lo
   * valide y lo haga efectivo con un botón (conciliación manual). Los pagos marcados como fraude
   * también entran a esa cola de revisión humana, independientemente de este toggle.
   */
  readonly autoConfirmSettlement: boolean;
  /**
   * Cuotas vencidas a partir de las cuales se agenda una visita del cobrador en campo. Tras
   * visitar, el cliente reaparece cuando la mora crece otro umbral (3 → 6 → 9 …). También es el
   * umbral con el que el mapa de cobro marca a un cliente como "crítico".
   */
  readonly visitOverdueThreshold: number;
  /**
   * Hora local (0–23) límite para que el cobrador rinda cuentas del efectivo cobrado en el día.
   * Pasada esa hora sin declarar, la rendición aparece atrasada (control del coordinador).
   */
  readonly remittanceDeadlineHourLocal: number;
  /** Liquidación por períodos: frecuencia, día de inicio y cierre automático. */
  readonly settlementFrequency: SettlementFrequency;
  readonly settlementAnchorDay: number;
  readonly settlementAutoClose: boolean;
  /** Día desde el que se liquida (YYYY-MM-DD); null = sin definir (el cierre automático no corre). */
  readonly settlementStartDate: string | null;
}

/** Vencimiento por defecto de la oferta de plan: un día (parametrizable por tenant). */
export const DEFAULT_PLAN_OFFER_TTL_HOURS = 24;

/** Umbral por defecto de cuotas vencidas para agendar una visita del cobrador. */
export const DEFAULT_VISIT_OVERDUE_THRESHOLD = 3;

/** Días hacia atrás permitidos por defecto para la fecha de un pago. */
export const DEFAULT_BACKDATE_MAX_DAYS = 3;

/** Hora local límite por defecto para rendir cuentas (20:00). */
export const DEFAULT_REMITTANCE_DEADLINE_HOUR = 20;

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  timeZone: DEFAULT_TIME_ZONE,
  rechargesEnabled: false,
  manualRoute: false,
  blockBackdatedPayments: true,
  backdateMaxDays: DEFAULT_BACKDATE_MAX_DAYS,
  relaxedPaymentDates: false,
  blockInterestChange: true,
  adminCustomInterestAllowed: true,
  commissionPctBaseThousand: 0,
  commissionsEnabled: false,
  commissionBase: "COLLECTED",
  commissionMaxPctBaseThousand: 0,
  defaultCreditLimitMinor: 0,
  applyColorByOverdue: false,
  clientChoosesPlan: false,
  planOfferTtlHours: DEFAULT_PLAN_OFFER_TTL_HOURS,
  allowAdminOverride: true,
  // Por defecto APAGADO: los pagos conciliados por settlement esperan aprobación humana.
  autoConfirmSettlement: false,
  visitOverdueThreshold: DEFAULT_VISIT_OVERDUE_THRESHOLD,
  remittanceDeadlineHourLocal: DEFAULT_REMITTANCE_DEADLINE_HOUR,
  settlementFrequency: DEFAULT_SETTLEMENT_SETTINGS.frequency,
  settlementAnchorDay: DEFAULT_SETTLEMENT_SETTINGS.anchorDay,
  settlementAutoClose: DEFAULT_SETTLEMENT_SETTINGS.autoClose,
  settlementStartDate: DEFAULT_SETTLEMENT_SETTINGS.startDate,
};

/** La configuración de liquidación contenida en los ajustes operativos. */
export function settlementSettingsOf(s: OperationalSettings): SettlementSettings {
  return {
    frequency: s.settlementFrequency,
    anchorDay: s.settlementAnchorDay,
    autoClose: s.settlementAutoClose,
    startDate: s.settlementStartDate ?? null,
  };
}

/**
 * Aplica un parche parcial sobre los ajustes actuales (inmutable; solo campos presentes) y valida
 * lo que depende de varios campos: el día de inicio de la liquidación según su frecuencia.
 */
export function mergeOperationalSettings(
  current: OperationalSettings,
  patch: Partial<OperationalSettings>,
): OperationalSettings {
  const merged = { ...current, ...patch };
  assertValidTimeZone(merged.timeZone);
  assertValidSettlementSettings(settlementSettingsOf(merged));
  // El valor por defecto también respeta el tope (bajar el tope exige bajar primero el defecto).
  assertValidCommissionCap(merged.commissionMaxPctBaseThousand);
  assertValidCommissionPolicy(
    { ratePerMille: merged.commissionPctBaseThousand, base: merged.commissionBase },
    merged.commissionMaxPctBaseThousand,
  );
  return merged;
}

/** Política de fechas atrasadas de pagos del tenant. */
export function backdatePolicyOf(s: OperationalSettings): BackdatePolicy {
  return {
    locked: s.blockBackdatedPayments,
    maxDaysBack: s.backdateMaxDays,
    relaxed: s.relaxedPaymentDates,
  };
}

/** Política antifraude del interés del tenant. */
export function interestPolicyOf(s: OperationalSettings): InterestPolicy {
  return { locked: s.blockInterestChange, adminCustomAllowed: s.adminCustomInterestAllowed };
}

/** Configuración de comisiones: la del tenant (ajustes) más lo configurado por zona. */
export function commissionConfigOf(
  s: OperationalSettings,
  zoneSettings: readonly ZoneCommissionSetting[],
): CommissionConfig {
  return {
    enabled: s.commissionsEnabled,
    tenantDefault: { ratePerMille: s.commissionPctBaseThousand, base: s.commissionBase },
    capPerMille: s.commissionMaxPctBaseThousand,
    zoneSettings,
  };
}
