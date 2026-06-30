import { namesLooselyMatch } from "../../antifraud/normalize-name";

// Match del RECEBEDOR (regla pura): la identidad del recibo debe coincidir con la cuenta
// recaudadora configurada del tenant. Si no coincide, el dinero no fue a nuestra cuenta
// (comprobante ajeno o adulterado) → señal fuerte de fraude. Si no hay con qué comparar
// (cuenta sin identidad configurada o recibo sin recebedor) el resultado es NO CONCLUYENTE.

/** Identidad configurada de la cuenta recaudadora del tenant. */
export interface ReceiverIdentity {
  readonly pixKey: string | null;
  readonly name: string | null;
}

/** Identidad del recebedor tal como viene en el comprobante. */
export interface ReceiverFromReceipt {
  readonly pixKey: string | null;
  readonly name: string | null;
}

export interface ReceiverMatchResult {
  readonly matches: boolean;
  /** true si no había datos comparables (no prueba ni descarta): señal blanda. */
  readonly inconclusive: boolean;
  readonly reasons: readonly string[];
}

/**
 * Normaliza una llave PIX para comparar por igualdad: minúsculas y sin separadores. Aunque
 * "mutile" un email (quita el punto), la comparación sigue siendo correcta porque AMBOS lados
 * se normalizan igual; cubre formatos de teléfono/CPF/CNPJ con o sin máscara y el '+' inicial.
 */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s().\-/+]/g, "");
}

export function matchReceiver(
  receipt: ReceiverFromReceipt,
  configured: ReceiverIdentity,
): ReceiverMatchResult {
  // 1) Llave PIX: comparación AUTORITATIVA cuando ambos lados la tienen (si la llave del recibo
  //    difiere, el crédito fue a otra cuenta — sin importar el nombre).
  if (configured.pixKey && receipt.pixKey) {
    const ok = normalizeKey(configured.pixKey) === normalizeKey(receipt.pixKey);
    return ok
      ? { matches: true, inconclusive: false, reasons: [] }
      : {
          matches: false,
          inconclusive: false,
          reasons: [
            "La llave PIX del recibo no coincide con la cuenta recaudadora",
          ],
        };
  }

  // 2) Titular: sin llaves comparables, se compara el nombre del recebedor (tolerante).
  if (configured.name && receipt.name) {
    const ok = namesLooselyMatch(configured.name, receipt.name);
    return ok
      ? { matches: true, inconclusive: false, reasons: [] }
      : {
          matches: false,
          inconclusive: false,
          reasons: [
            "El titular del recibo no coincide con la cuenta recaudadora",
          ],
        };
  }

  // 3) Nada con qué comparar: no concluyente.
  return { matches: false, inconclusive: true, reasons: [] };
}
