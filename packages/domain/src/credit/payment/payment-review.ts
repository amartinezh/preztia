// Regla de negocio PURA para decidir qué hacer con un comprobante de pago
// recién recibido (por lo general un PIX de Brasil), combinando: (1) el
// veredicto antifraude estructural, (2) la extracción de la IA y (3) la
// verificación en línea contra el banco recaudador.
//
// Análoga a `decideDocumentReview`: no conoce IA, BD ni HTTP; recibe señales ya
// resueltas por la infraestructura y devuelve la decisión auditable.

import { ConflictError } from "../../shared/money";
import { type FraudAssessment, isAcceptable } from "../application/fraud";

/** Estado de un pago registrado a partir de un comprobante. */
export type PaymentStatus =
  | "RECEIVED"
  | "VERIFIED"
  | "UNVERIFIED"
  | "REJECTED_FRAUD"
  | "REJECTED_INVALID";

/**
 * Regla de la validación MANUAL del coordinador/admin: solo puede hacerse efectiva una vez. Un
 * pago ya VERIFIED no se revalida (idempotencia del dinero); cualquier otro estado (recibido, sin
 * verificar, rechazado por fraude/inválido) sí puede aceptarse manualmente a discreción.
 */
export function assertManuallyVerifiable(status: PaymentStatus): void {
  if (status === "VERIFIED") {
    throw new ConflictError("El pago ya está verificado; no puede validarse de nuevo");
  }
}

/**
 * Datos extraídos del comprobante PIX. Los campos varían según el banco emisor:
 * lo no tipado queda en `raw` para trazabilidad. `payerTaxId` (CPF/CNPJ) es PII:
 * jamás debe ir a logs.
 */
export interface PixReceiptData {
  readonly amountMinor: number | null;
  readonly currency: string;
  /** Momento del pago según el comprobante (ISO timestamptz). */
  readonly paidAt: string | null;
  readonly payerName: string | null;
  readonly payerTaxId: string | null;
  readonly payerBankName: string | null;
  readonly receiverName: string | null;
  readonly receiverPixKey: string | null;
  /** Identificador único end-to-end de la transacción PIX (E...). */
  readonly endToEndId: string | null;
  readonly txid: string | null;
  /** Resto de campos variables extraídos, para auditoría. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** Veredicto del clasificador de media entrante (una sola llamada classify+extract). */
export type MediaClassification =
  | { readonly kind: "payment_receipt"; readonly confidence: number; readonly pix: PixReceiptData }
  | { readonly kind: "kyc_document"; readonly confidence: number }
  | { readonly kind: "unknown"; readonly confidence: number };

/** Resultado de consultar el pago en el banco recaudador. */
export type BankVerification =
  | {
      readonly status: "confirmed";
      /** Monto confirmado por el banco: es la fuente de verdad del abono. */
      readonly bankAmountMinor: number;
      readonly bankPaidAt: string | null;
    }
  | { readonly status: "not_found" }
  | { readonly status: "unavailable"; readonly reason: string };

/** Decisión sobre el comprobante recibido. */
export type PaymentReviewDecision =
  /** Confirmado por el banco: se abona el monto bancario. */
  | { readonly kind: "accepted_verified"; readonly amountMinor: number; readonly assessment: FraudAssessment }
  /** No se pudo confirmar aún: queda pendiente de conciliación. */
  | { readonly kind: "accepted_unverified"; readonly amountMinor: number; readonly reasons: readonly string[] }
  /** Ilegible o no es un comprobante: se pide reenviar. */
  | { readonly kind: "rejected_invalid"; readonly reasons: readonly string[] }
  /** Veredicto antifraude duro: se registra y se escala a revisión. */
  | { readonly kind: "rejected_fraud"; readonly reasons: readonly string[] };

const MISMATCH_SUSPICION_SCORE = 60;

/**
 * Decide el destino de un comprobante de pago.
 *
 * Invariantes:
 * - Si el antifraude estructural rechaza, el pago se rechaza sin abonar.
 * - Sin monto legible no hay abono posible: se rechaza como inválido.
 * - Si el banco confirma, el monto BANCARIO manda; una diferencia con lo extraído
 *   no bloquea el abono (el dinero llegó) pero queda marcada como sospechosa.
 * - `not_found`/`unavailable` NO acusan fraude en línea: el pago queda
 *   UNVERIFIED y la conciliación batch decide después.
 */
export function decidePaymentReview(input: {
  readonly structural: FraudAssessment;
  readonly pix: PixReceiptData | null;
  readonly bank: BankVerification;
}): PaymentReviewDecision {
  if (!isAcceptable(input.structural)) {
    return { kind: "rejected_fraud", reasons: input.structural.reasons };
  }

  if (!input.pix || input.pix.amountMinor === null || input.pix.amountMinor <= 0) {
    return { kind: "rejected_invalid", reasons: ["No se pudo leer el monto del comprobante"] };
  }

  if (input.bank.status === "confirmed") {
    const mismatch = input.bank.bankAmountMinor !== input.pix.amountMinor;
    const assessment: FraudAssessment = mismatch
      ? {
          status: "suspicious",
          score: Math.max(input.structural.score, MISMATCH_SUSPICION_SCORE),
          reasons: [
            ...input.structural.reasons,
            "El monto extraído del comprobante difiere del confirmado por el banco",
          ],
        }
      : input.structural;
    return { kind: "accepted_verified", amountMinor: input.bank.bankAmountMinor, assessment };
  }

  const reason =
    input.bank.status === "not_found"
      ? "El banco aún no reporta esta transacción; queda en conciliación"
      : `Verificación bancaria no disponible (${input.bank.reason}); queda en conciliación`;
  return { kind: "accepted_unverified", amountMinor: input.pix.amountMinor, reasons: [reason] };
}
