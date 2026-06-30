import type {
  BankVerification,
  FraudAssessment,
  MediaClassification,
  NormalizedCredit,
  PaymentAllocation,
  PaymentStatus,
  PixReceiptData,
  PortfolioInstallment,
} from "@preztiaos/domain";
import type { DownloadedMedia, StoredDocument } from "../application/ports";

// Puertos de salida del slice de pagos (PIX). La infraestructura provee la
// implementación concreta (Drizzle, Gemini, MinIO, bancos).

/** Cartera activa de un cliente: el crédito ACTIVO y sus cuotas. */
export interface ActiveCreditPortfolio {
  readonly creditId: string;
  readonly currency: string;
  readonly installments: readonly PortfolioInstallment[];
}

/** Estado de verificación bancaria persistible (espejo de BankVerification). */
export type PersistedBankStatus = "CONFIRMED" | "NOT_FOUND" | "UNAVAILABLE";

/** Registro completo del pago a persistir (detalles del PIX + evidencia + veredicto). */
export interface PaymentRecord {
  readonly tenantId: string;
  /** null cuando el comprobante llegó sin crédito activo (huérfano auditado). */
  readonly creditId: string | null;
  readonly providerMessageId: string;
  /** phone_number_id del canal de WhatsApp (para notificar en la conciliación). */
  readonly channelId: string;
  readonly payerPhone: string;
  readonly amountMinor: number | null;
  readonly currency: string;
  readonly paidAt: string | null;
  readonly payerName: string | null;
  readonly payerTaxId: string | null;
  readonly payerBankName: string | null;
  readonly receiverPixKey: string | null;
  readonly endToEndId: string | null;
  readonly txid: string | null;
  readonly extractionRaw: Readonly<Record<string, unknown>> | null;
  readonly sha256: string;
  readonly storageKey: string | null;
  readonly mimeType: string;
  readonly status: PaymentStatus;
  readonly bankStatus: PersistedBankStatus | null;
  readonly bankResponse: unknown;
  readonly fraudScore: number | null;
  readonly fraudReasons: readonly string[] | null;
}

/** Evento de auditoría del pago (append-only). */
export interface PaymentAuditEvent {
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** Resultado completo a persistir en UNA transacción (pago + abonos + cuotas + eventos). */
export interface PaymentOutcome {
  readonly payment: PaymentRecord;
  readonly allocations: readonly PaymentAllocation[];
  /** Estado resultante de las cuotas abonadas (solo las que cambiaron). */
  readonly installments: readonly PortfolioInstallment[];
  /** true si la cartera quedó saldada: el crédito pasa a SETTLED. */
  readonly creditSettled: boolean;
  readonly events: readonly PaymentAuditEvent[];
}

/**
 * Puerto: persistencia de la cartera y los pagos (bajo RLS). `savePaymentOutcome`
 * ejecuta UNA transacción con bloqueo de cuotas (FOR UPDATE) e idempotencia por
 * `endToEndId`: un PIX repetido no genera doble abono.
 */
export interface CreditPortfolioRepository {
  findActiveByPhone(input: { tenantId: string; phone: string }): Promise<ActiveCreditPortfolio | null>;
  savePaymentOutcome(outcome: PaymentOutcome): Promise<void>;
}

/**
 * Puerto: clasifica un media entrante (¿comprobante de pago o documento KYC?) y,
 * si es comprobante, extrae TODOS los campos del PIX en la misma llamada de IA.
 */
export interface MediaClassifier {
  classify(input: { tenantId: string; media: DownloadedMedia }): Promise<MediaClassification>;
}

/** Contexto que el antifraude de pagos evalúa para un comprobante. */
export interface PaymentAntifraudInput {
  readonly tenantId: string;
  readonly sha256: string;
  readonly pix: PixReceiptData | null;
  /** Momento de recepción del comprobante (ISO timestamptz). */
  readonly receivedAt: string;
  readonly payerPhone: string;
}

/** Puerto: antifraude de pagos (extensible por reglas en infraestructura). */
export interface PaymentAntifraudService {
  assess(input: PaymentAntifraudInput): Promise<FraudAssessment>;
}

/** Resultado de la consulta al banco: el veredicto + la respuesta cruda (trazabilidad). */
export interface BankVerificationResult {
  readonly verification: BankVerification;
  readonly rawResponse?: unknown;
}

/**
 * Puerto: verifica un pago contra el banco recaudador. La infraestructura resuelve
 * el adaptador por (countryCode, bankCode); la autenticación (API key, OAuth, mTLS)
 * es un detalle del adaptador.
 */
export interface BankPaymentVerifier {
  verify(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
    pix: PixReceiptData;
  }): Promise<BankVerificationResult>;
}

/** Puerto: almacena el comprobante como evidencia (cifrado en reposo). */
export interface PaymentReceiptStorage {
  store(input: {
    tenantId: string;
    creditId: string | null;
    media: DownloadedMedia;
  }): Promise<StoredDocument>;
}

/** Cuenta bancaria recaudadora activa del tenant (país + entidad + política). */
export interface ActiveTenantBankAccount {
  readonly countryCode: string;
  readonly bankCode: string;
  /** Qué hacer con pagos que el banco aún no confirma: retener o abonar. */
  readonly unverifiedPolicy: "HOLD" | "ALLOCATE";
}

/** Puerto: configuración bancaria del tenant. */
export interface TenantBankAccountRepository {
  findActive(tenantId: string): Promise<ActiveTenantBankAccount | null>;
}

/** Ventana de conciliación para traer créditos de la fuente de liquidación. */
export interface SettlementWindow {
  readonly tenantId: string;
  readonly countryCode: string;
  readonly bankCode: string;
  /** Inicio/fin de la ventana (ISO). */
  readonly begin: string;
  readonly end: string;
}

/**
 * Puerto: fuente de CRÉDITOS confirmados (ground truth) de una cuenta recaudadora. Abstrae de
 * dónde salen los ingresos reales (ej. settlement_report de Mercado Pago). La infraestructura
 * resuelve el adaptador por (countryCode, bankCode); un proveedor sin soporte degrada a lista
 * vacía (la conciliación queda sin confirmar, nunca rompe). El consumo idempotente por
 * SOURCE_ID lo garantiza la persistencia (incoming_credit), no este puerto.
 */
export interface SettlementSource {
  fetchCredits(window: SettlementWindow): Promise<readonly NormalizedCredit[]>;
}
