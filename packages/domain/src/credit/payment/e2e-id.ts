// Análisis ESTRUCTURAL del EndToEndId del PIX (regla pura, sin I/O).
//
// Estructura oficial del Banco Central (Manual de Padrões para Iniciação do Pix):
//   ExxxxxxxxyyyyMMddHHmmkkkkkkkkkkk   (32 caracteres, case-sensitive)
//     E            → fijo (1)
//     xxxxxxxx     → ISPB del participante emisor: 8 dígitos [0-9]
//     yyyyMMddHHmm → fecha/hora UTC de generación (12)
//     kkkkkkkkkkk  → secuencial/identificador (11 alfanuméricos)
//
// Esto solo valida la FORMA (determinista). Que el ISPB corresponda a una institución real es
// otra señal (ver ispb-registry); que el crédito haya entrado de verdad lo decide la Fase 2.

export const E2E_ID_LENGTH = 32;

// Tolerancia hacia el futuro: un E2E real no puede tener fecha futura, pero se admite un margen
// por desfases de reloj/zona horaria entre la generación y el procesamiento del comprobante.
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface E2EIdAnalysis {
  /** La forma es válida (longitud, prefijo, ISPB, fecha y secuencial bien formados). */
  readonly valid: boolean;
  /** ISPB (8 dígitos) si esa posición es válida; `null` si está malformado. */
  readonly ispb: string | null;
  /** Fecha/hora UTC parseada si es válida; `null` si está malformada. */
  readonly issuedAt: Date | null;
  /** Problemas estructurales encontrados (vacío si `valid`). */
  readonly problems: readonly string[];
}

/** Analiza la estructura de un EndToEndId. `now` se inyecta para tests deterministas. */
export function analyzeE2EId(raw: string, now: Date = new Date()): E2EIdAnalysis {
  const value = raw.trim();
  const problems: string[] = [];

  if (value.length !== E2E_ID_LENGTH) {
    problems.push(
      `longitud inválida (${value.length}; se esperaban ${E2E_ID_LENGTH})`,
    );
  }
  if (!value.startsWith("E")) problems.push("no inicia con 'E'");

  const ispbRaw = value.slice(1, 9);
  const ispbOk = /^[0-9]{8}$/.test(ispbRaw);
  if (!ispbOk) problems.push("ISPB malformado (se esperan 8 dígitos)");

  const issuedAt = parseE2ETimestamp(value.slice(9, 21));
  if (!issuedAt) {
    problems.push("fecha/hora malformada (yyyyMMddHHmm)");
  } else if (issuedAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS) {
    problems.push("fecha/hora en el futuro");
  }

  if (!/^[A-Za-z0-9]{11}$/.test(value.slice(21))) {
    problems.push("secuencial malformado (11 alfanuméricos)");
  }

  return {
    valid: problems.length === 0,
    ispb: ispbOk ? ispbRaw : null,
    issuedAt,
    problems,
  };
}

/** Parsea `yyyyMMddHHmm` (UTC) a `Date`; `null` si no es una fecha de calendario real. */
function parseE2ETimestamp(ts: string): Date | null {
  if (!/^[0-9]{12}$/.test(ts)) return null;
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(4, 6));
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(8, 10));
  const minute = Number(ts.slice(10, 12));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  // Round-trip: descarta fechas imposibles (ej. 31 de febrero corre el mes).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}
