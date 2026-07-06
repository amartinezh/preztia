// Puertos del slice de COBRO CONVERSACIONAL (cobrança PIX generada al vuelo desde WhatsApp). La
// aplicación los define; la infraestructura (Drizzle / PicPay / WhatsApp) los implementa.

/** Proveedor que puede generar cobranças; hoy solo PicPay. */
export type ChargeProvider = "PICPAY";

/** Sesión abierta del diálogo de cobro: el cliente ya vio el menú y se espera su elección. */
export interface OpenChargeSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly creditId: string;
  readonly installmentMinor: number;
  readonly overdueMinor: number;
  readonly currency: string;
}

/** Crédito cobrable de un teléfono: lo que el caso de uso necesita para ofrecer el menú. */
export interface ChargeableCredit {
  readonly tenantId: string;
  readonly creditId: string;
  readonly firstName: string;
  /** Cuota del día en unidades menores. */
  readonly installmentMinor: number;
  /** Todo lo vencido a hoy (cuota + atrasos) en unidades menores. */
  readonly overdueMinor: number;
  readonly currency: string;
  readonly provider: ChargeProvider;
}

/**
 * Read model + persistencia de la sesión/cobrança. Resuelve el tenant por el canal (el webhook no
 * lo trae). El aislamiento lo garantiza RLS con el tenant ya fijado.
 */
export interface PaymentChargeSessionStore {
  /** Sesión ABIERTA (esperando elección) del teléfono en este canal; `null` si no hay. */
  findOpenByChannel(input: {
    channelId: string;
    phone: string;
  }): Promise<OpenChargeSession | null>;

  /** Abre una sesión de cobro (reemplaza cualquier sesión abierta previa del mismo teléfono). */
  openSession(input: {
    tenantId: string;
    creditId: string;
    phone: string;
    channelId: string;
    provider: ChargeProvider;
    installmentMinor: number;
    overdueMinor: number;
    currency: string;
  }): Promise<void>;

  /**
   * Adjunta la cobrança generada a la sesión: crea el COMPROBANTE esperado (pago UNVERIFIED con el
   * monto) y avanza la sesión a PENDING con el merchantChargeId/copia-e-cola. Atómico.
   */
  attachCharge(input: {
    sessionId: string;
    tenantId: string;
    amountMinor: number;
    merchantChargeId: string;
    copyPaste: string;
    expiresAt: string | null;
  }): Promise<void>;

  /** Marca la sesión como fallida (no se pudo generar la cobrança en el proveedor). */
  markFailed(input: { sessionId: string; tenantId: string }): Promise<void>;
}

/** Read model de la cartera para el cobro conversacional (resuelve tenant por canal). */
export interface ChargeableCreditReader {
  /** Crédito cobrable del teléfono en este canal; `null` si no hay crédito activo o proveedor. */
  findChargeableByPhone(input: {
    channelId: string;
    phone: string;
  }): Promise<ChargeableCredit | null>;
}

/** Cobrança generada por el proveedor (lo mínimo para instruir el pago y emparejar el webhook). */
export interface CreatedCharge {
  readonly merchantChargeId: string;
  /** Código PIX "copia e cola". */
  readonly copyPaste: string;
  /** Vencimiento del código (ISO); `null` si el proveedor no lo informa. */
  readonly expiresAt: string | null;
}

/**
 * Puerto de salida: genera una cobrança PIX en el proveedor (ej. PicPay `POST /charge/pix`). La
 * autenticación (OAuth2) y el HTTP son detalle del adaptador. Lanza si el proveedor la rechaza.
 */
export interface ChargeGateway {
  createCharge(input: {
    tenantId: string;
    creditId: string;
    amountMinor: number;
    currency: string;
    payerPhone: string;
    expiresInMinutes: number;
  }): Promise<CreatedCharge>;
}
