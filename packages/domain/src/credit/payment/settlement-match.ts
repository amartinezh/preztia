// Conciliación de la Fase 2 (regla pura, sin I/O): empareja COMPROBANTES pendientes (claims)
// con CRÉDITOS reales liberados por la fuente de liquidación (ej. settlement_report de Mercado
// Pago). El "ground truth" es el crédito; la imagen del comprobante nunca libera dinero.
//
// Estrategia de match DETERMINISTA: por MONTO ÚNICO (centavos únicos por pedido) + consumo de
// cada crédito a lo sumo una vez (por SOURCE_ID). Invariantes verificables en los tests:
//   I1  un crédito valida a lo sumo UN comprobante (sourceId consumido una vez)
//   I2  el match exige monto EXACTO (centavos)
//   I3  solo cuentan créditos PIX recibidos (bank_transfer, neto > 0, sin REFUND/CHARGEBACK)
//   I5  comprobante sin crédito tras la ventana → queda sin confirmar (UNCONFIRMED)
//   I6  un "match" es la ÚNICA vía de confirmación (la IA nunca confirma)

const PIX_PAYMENT_METHOD = "bank_transfer";
const EXCLUDED_TRANSACTION_TYPES: ReadonlySet<string> = new Set([
  "refund",
  "chargeback",
]);

/** Crédito normalizado desde la fuente de liquidación (una fila del reporte). */
export interface NormalizedCredit {
  /** Identificador único de la fila en la fuente (idempotencia de consumo). */
  readonly sourceId: string;
  /** Monto bruto de la transacción (lo que envió el pagador) en unidades menores. */
  readonly amountMinor: number;
  /** Monto neto liquidado a la cuenta en unidades menores (debe ser > 0 para ser ingreso). */
  readonly netAmountMinor: number;
  readonly currency: string;
  /** Medio de pago de la fuente: "bank_transfer" para PIX. */
  readonly paymentMethodType: string;
  /** Tipo de transacción de la fuente: permite excluir REFUND/CHARGEBACK. */
  readonly transactionType: string;
  /** Fecha de liquidación (ISO); ordena el consumo de forma determinista. */
  readonly settlementDate: string;
}

/** Referencia mínima de un comprobante pendiente: su id y el monto único esperado. */
export interface ReceiptClaimRef {
  readonly id: string;
  readonly amountMinor: number;
}

/** Emparejamiento confirmado comprobante ↔ crédito real. */
export interface CreditMatch {
  readonly claimId: string;
  readonly sourceId: string;
  readonly amountMinor: number;
}

export interface SettlementMatchResult {
  readonly matches: readonly CreditMatch[];
  /** Comprobantes que no encontraron crédito en la ventana → UNCONFIRMED. */
  readonly unmatchedClaimIds: readonly string[];
}

/** I3: ¿la fila es un ingreso PIX real? (bank_transfer, neto > 0, sin REFUND/CHARGEBACK). */
export function isEligiblePixCredit(credit: NormalizedCredit): boolean {
  if (credit.paymentMethodType.toLowerCase() !== PIX_PAYMENT_METHOD) return false;
  if (credit.netAmountMinor <= 0) return false;
  if (EXCLUDED_TRANSACTION_TYPES.has(credit.transactionType.toLowerCase())) {
    return false;
  }
  return true;
}

/**
 * Empareja comprobantes con créditos por monto exacto, consumiendo cada crédito una sola vez.
 * Determinista: ordena créditos por (settlementDate, sourceId) y comprobantes por id, y asigna
 * de forma codiciosa. Los `credits` deben ser los AÚN NO consumidos (el repositorio filtra los
 * ya ligados a un pago); aquí se aplica además el filtro PIX (I3).
 */
export function matchCreditsToClaims(
  claims: readonly ReceiptClaimRef[],
  credits: readonly NormalizedCredit[],
): SettlementMatchResult {
  const pool = credits.filter(isEligiblePixCredit).sort(byDateThenSource);
  const consumed = new Set<number>();
  const matches: CreditMatch[] = [];
  const unmatchedClaimIds: string[] = [];

  for (const claim of [...claims].sort(byClaimId)) {
    let matched: NormalizedCredit | undefined;
    for (let i = 0; i < pool.length; i++) {
      const credit = pool[i];
      if (consumed.has(i) || !credit) continue;
      if (credit.amountMinor === claim.amountMinor) {
        consumed.add(i);
        matched = credit;
        break;
      }
    }
    if (!matched) {
      unmatchedClaimIds.push(claim.id);
      continue;
    }
    matches.push({
      claimId: claim.id,
      sourceId: matched.sourceId,
      amountMinor: claim.amountMinor,
    });
  }

  return { matches, unmatchedClaimIds };
}

function byDateThenSource(a: NormalizedCredit, b: NormalizedCredit): number {
  if (a.settlementDate !== b.settlementDate) {
    return a.settlementDate < b.settlementDate ? -1 : 1;
  }
  return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
}

function byClaimId(a: ReceiptClaimRef, b: ReceiptClaimRef): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
