// Conciliación de la Fase 2 (regla pura, sin I/O): empareja COMPROBANTES pendientes (claims)
// con CRÉDITOS reales liberados por la fuente de liquidación (ej. settlement_report de Mercado
// Pago o webhooks PAID de PicPay). El "ground truth" es el crédito; la imagen del comprobante
// nunca libera dinero.
//
// Estrategia de match DETERMINISTA, en dos pasadas:
//   Pasada 1 — por END-TO-END ID: si el comprobante y el crédito traen E2E y coinciden, el
//              match es inequívoco (el E2E identifica la transacción PIX en todo el sistema).
//   Pasada 2 — por MONTO ÚNICO (centavos únicos por pedido) entre los restantes.
// Cada crédito se consume a lo sumo una vez (por SOURCE_ID). Invariantes verificables en tests:
//   I1  un crédito valida a lo sumo UN comprobante (sourceId consumido una vez)
//   I2  el match exige monto EXACTO (centavos) o E2E idéntico
//   I3  solo cuentan créditos PIX recibidos (bank_transfer, neto > 0, sin REFUND/CHARGEBACK)
//   I5  comprobante sin crédito tras la ventana → queda sin confirmar (UNCONFIRMED)
//   I6  un "match" es la ÚNICA vía de confirmación (la IA nunca confirma)
//   I7  el match por E2E tiene PRIORIDAD sobre el match por monto (más específico primero)

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
  /** EndToEndId del PIX cuando la fuente lo trae (PicPay); habilita el match por E2E. */
  readonly endToEndId?: string | null;
}

/** Referencia mínima de un comprobante pendiente: id, monto único esperado y E2E (si se leyó). */
export interface ReceiptClaimRef {
  readonly id: string;
  readonly amountMinor: number;
  /** EndToEndId extraído del comprobante; null/ausente si la IA no lo leyó. */
  readonly endToEndId?: string | null;
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
 * Empareja comprobantes con créditos consumiendo cada crédito una sola vez, en dos pasadas:
 * primero por END-TO-END ID idéntico (I7, inequívoco) y luego por monto exacto entre los
 * restantes. Determinista: ordena créditos por (settlementDate, sourceId) y comprobantes por
 * id, y asigna de forma codiciosa. Los `credits` deben ser los AÚN NO consumidos (el
 * repositorio filtra los ya ligados a un pago); aquí se aplica además el filtro PIX (I3).
 */
export function matchCreditsToClaims(
  claims: readonly ReceiptClaimRef[],
  credits: readonly NormalizedCredit[],
): SettlementMatchResult {
  const pool = credits.filter(isEligiblePixCredit).sort(byDateThenSource);
  const consumed = new Set<number>();
  const matchedClaims = new Map<string, NormalizedCredit>();
  const orderedClaims = [...claims].sort(byClaimId);

  // Pasada 1 — E2E idéntico (ambos presentes): match inequívoco, sin depender del monto único.
  for (const claim of orderedClaims) {
    if (!claim.endToEndId) continue;
    const i = pool.findIndex(
      (credit, idx) =>
        !consumed.has(idx) &&
        credit.endToEndId != null &&
        credit.endToEndId === claim.endToEndId,
    );
    if (i === -1) continue;
    consumed.add(i);
    matchedClaims.set(claim.id, pool[i]!);
  }

  // Pasada 2 — monto exacto (centavos únicos por pedido) entre los aún libres.
  for (const claim of orderedClaims) {
    if (matchedClaims.has(claim.id)) continue;
    const i = pool.findIndex(
      (credit, idx) => !consumed.has(idx) && credit.amountMinor === claim.amountMinor,
    );
    if (i === -1) continue;
    consumed.add(i);
    matchedClaims.set(claim.id, pool[i]!);
  }

  const matches: CreditMatch[] = [];
  const unmatchedClaimIds: string[] = [];
  for (const claim of orderedClaims) {
    const credit = matchedClaims.get(claim.id);
    if (!credit) {
      unmatchedClaimIds.push(claim.id);
      continue;
    }
    // El monto abonable es el del CRÉDITO real (en el match por E2E puede diferir del extraído).
    matches.push({ claimId: claim.id, sourceId: credit.sourceId, amountMinor: credit.amountMinor });
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
