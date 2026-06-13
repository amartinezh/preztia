// Línea digitable FEBRABAN de arrecadação/convenio (48 dígitos): la usan los
// recibos de servicios públicos de Brasil (luz, agua, gas, teléfono).
//
// Estructura del código de barras subyacente (44 dígitos = 4 bloques de 11):
//   pos 1      → '8' (identificador de arrecadação)
//   pos 2      → segmento (1=prefeitura, 2=saneamiento, 3=energía/gas, 4=telecom, 5=gov…)
//   pos 3      → identificador de valor: 6/7 ⇒ DV módulo 10; 8/9 ⇒ DV módulo 11.
//                6 y 8 codifican VALOR en centavos; 7 y 9, cantidad de moneda.
//   pos 4      → DV general sobre los otros 43 dígitos
//   pos 5-15   → valor (11 dígitos, centavos)
//   pos 16-19  → código de la empresa/órgano (convenio FEBRABAN)
// La línea digitable agrega un DV (mismo módulo) al final de cada bloque de 11.
//
// El valor viaja DENTRO del código: si adulteraron el monto impreso pero no la
// línea digitable, el cruce con el valor extraído lo delata (invariante CRITICA).

import { alerta, type ValidationAlert } from "./alert";
import { onlyDigits } from "./taxpayer-id";

const LINHA_DIGITAVEL_LENGTH = 48;
const BARCODE_LENGTH = 44;
const BLOCK_DATA_LENGTH = 11;
const BLOCKS = 4;

const ARRECADACAO_PRODUCT_ID = "8";

/** Segmentos de arrecadação que corresponden a un servicio público domiciliario. */
export const UTILITY_SEGMENTS: ReadonlySet<number> = new Set([2, 3, 4]);

/** Nombre de cada segmento (para mensajes legibles). */
const SEGMENT_NAMES: Record<number, string> = {
  1: "prefeitura",
  2: "saneamiento",
  3: "energía eléctrica/gas",
  4: "telecomunicaciones",
  5: "órganos de gobierno",
  6: "carnés",
  7: "multas de tránsito",
  9: "uso exclusivo de bancos",
};

/** Datos decodificados de una línea digitable de convenio válida. */
export interface LinhaDigitavelConvenio {
  readonly segmento: number;
  /** Valor codificado en centavos; null cuando codifica cantidad de moneda. */
  readonly valorMinor: number | null;
  /** Código de empresa/órgano (posiciones 16-19 del código de barras). */
  readonly empresa: string;
}

export type LinhaDigitavelResultado =
  | { readonly valida: true; readonly dados: LinhaDigitavelConvenio }
  | { readonly valida: false; readonly motivo: string };

function digitAt(digits: string, index: number): number {
  return digits.charCodeAt(index) - 48;
}

/** DV módulo 10 FEBRABAN: pesos 2,1,2,1… de derecha a izquierda, suma de dígitos. */
export function mod10CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, weight = 2; i >= 0; i--, weight = weight === 2 ? 1 : 2) {
    const product = digitAt(digits, i) * weight;
    sum += product > 9 ? product - 9 : product;
  }
  return (10 - (sum % 10)) % 10;
}

/** DV módulo 11 FEBRABAN (arrecadação): pesos 2..9 cíclicos; 10/11 ⇒ 0. */
export function mod11CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, weight = 2; i >= 0; i--, weight = weight === 9 ? 2 : weight + 1) {
    sum += digitAt(digits, i) * weight;
  }
  const dv = 11 - (sum % 11);
  return dv >= 10 ? 0 : dv;
}

/** Valida estructura y dígitos verificadores; decodifica segmento, valor y empresa. */
export function parseLinhaDigitavelConvenio(linha: string): LinhaDigitavelResultado {
  const digits = onlyDigits(linha);
  if (digits.length !== LINHA_DIGITAVEL_LENGTH) {
    return { valida: false, motivo: `longitud ${digits.length}, se esperaban 48 dígitos` };
  }
  if (!digits.startsWith(ARRECADACAO_PRODUCT_ID)) {
    return { valida: false, motivo: "no inicia con '8' (no es arrecadação)" };
  }

  const valueId = digitAt(digits, 2);
  if (valueId < 6 || valueId > 9) {
    return { valida: false, motivo: `identificador de valor inválido (${valueId})` };
  }
  const checkDigitOf = valueId === 6 || valueId === 7 ? mod10CheckDigit : mod11CheckDigit;

  // Reconstruye el código de barras y verifica el DV de cada bloque de la línea.
  let barcode = "";
  for (let block = 0; block < BLOCKS; block++) {
    const start = block * (BLOCK_DATA_LENGTH + 1);
    const data = digits.slice(start, start + BLOCK_DATA_LENGTH);
    const dv = digitAt(digits, start + BLOCK_DATA_LENGTH);
    if (checkDigitOf(data) !== dv) {
      return { valida: false, motivo: `dígito verificador del bloque ${block + 1} no coincide` };
    }
    barcode += data;
  }

  // DV general (posición 4) sobre los demás 43 dígitos del código de barras.
  const generalDv = digitAt(barcode, 3);
  const withoutGeneralDv = barcode.slice(0, 3) + barcode.slice(4, BARCODE_LENGTH);
  if (checkDigitOf(withoutGeneralDv) !== generalDv) {
    return { valida: false, motivo: "dígito verificador general no coincide" };
  }

  const segmento = digitAt(barcode, 1);
  const encodesAmount = valueId === 6 || valueId === 8;
  const valorMinor = encodesAmount ? Number(barcode.slice(4, 15)) : null;
  return {
    valida: true,
    dados: { segmento, valorMinor, empresa: barcode.slice(15, 19) },
  };
}

/**
 * Reglas antifraude sobre la línea digitable de un recibo:
 * - inválida estructuralmente ⇒ ALTA (boleto generado/alterado);
 * - valor codificado ≠ valor impreso ⇒ CRITICA (monto adulterado);
 * - segmento que no es de servicio público ⇒ MEDIA (documento de otro rubro).
 */
export function reviewLinhaDigitavel(input: {
  readonly linha: string;
  /** Valor impreso en el recibo, en centavos; null si no se pudo extraer. */
  readonly valorImpresoMinor: number | null;
}): ValidationAlert[] {
  const resultado = parseLinhaDigitavelConvenio(input.linha);
  if (!resultado.valida) {
    return [
      alerta(
        "linha_digitavel",
        "ALTA",
        `línea digitable inválida: ${resultado.motivo}`,
      ),
    ];
  }

  const alerts: ValidationAlert[] = [];
  const { segmento, valorMinor } = resultado.dados;

  if (
    valorMinor !== null &&
    input.valorImpresoMinor !== null &&
    valorMinor !== input.valorImpresoMinor
  ) {
    alerts.push(
      alerta(
        "valor",
        "CRITICA",
        `el valor impreso (${input.valorImpresoMinor} centavos) no coincide con el codificado en el código de barras (${valorMinor} centavos)`,
      ),
    );
  }

  if (!UTILITY_SEGMENTS.has(segmento)) {
    const nombre = SEGMENT_NAMES[segmento] ?? "desconocido";
    alerts.push(
      alerta(
        "linha_digitavel",
        "MEDIA",
        `el segmento del código de barras (${segmento}: ${nombre}) no corresponde a un servicio público domiciliario`,
      ),
    );
  }

  return alerts;
}
