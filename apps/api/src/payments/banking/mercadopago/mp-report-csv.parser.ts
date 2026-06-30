import { type NormalizedCredit } from '@preztiaos/domain';

// Parser del CSV del settlement_report de Mercado Pago → NormalizedCredit[]. PURO y robusto:
// maneja campos entrecomillados con comas internas y comillas escapadas (""), CRLF/LF y BOM.
// Los encabezados dependen del report_translation (que el adaptador FIJA): el mapeo de columnas
// es configurable. Los montos pueden venir con coma o punto decimal (también configurable).
// No filtra elegibilidad (eso vive en el dominio `isEligiblePixCredit`): traduce filas a créditos.

/** Nombres de columna del reporte (según el report_translation fijado). */
export interface SettlementColumnNames {
  readonly sourceId: string;
  readonly amount: string;
  readonly netAmount: string;
  readonly currency: string;
  readonly paymentMethodType: string;
  readonly transactionType: string;
  readonly settlementDate: string;
}

// Encabezados del reporte en inglés (report_translation = "en"), el que fija el adaptador.
export const SETTLEMENT_COLUMNS_EN: SettlementColumnNames = {
  sourceId: 'SOURCE_ID',
  amount: 'TRANSACTION_AMOUNT',
  netAmount: 'SETTLEMENT_NET_AMOUNT',
  currency: 'TRANSACTION_CURRENCY',
  paymentMethodType: 'PAYMENT_METHOD_TYPE',
  transactionType: 'TRANSACTION_TYPE',
  settlementDate: 'SETTLEMENT_DATE',
};

export interface ParseSettlementOptions {
  readonly columns?: SettlementColumnNames;
  readonly decimalSeparator?: '.' | ',';
  readonly delimiter?: string;
  /** Moneda por defecto si la columna no está presente/está vacía. */
  readonly defaultCurrency?: string;
}

/** Convierte el CSV en filas de créditos normalizados; ignora filas sin SOURCE_ID. */
export function parseSettlementCsv(
  csv: string,
  options: ParseSettlementOptions = {},
): NormalizedCredit[] {
  const columns = options.columns ?? SETTLEMENT_COLUMNS_EN;
  const decimalSeparator = options.decimalSeparator ?? '.';
  const delimiter = options.delimiter ?? ',';
  const defaultCurrency = options.defaultCurrency ?? 'BRL';

  const rows = tokenizeCsv(stripBom(csv), delimiter);
  const header = rows.shift();
  if (!header) return [];

  const indexOf = (name: string): number =>
    header.findIndex((h) => h.trim() === name);
  const idx = {
    sourceId: indexOf(columns.sourceId),
    amount: indexOf(columns.amount),
    netAmount: indexOf(columns.netAmount),
    currency: indexOf(columns.currency),
    paymentMethodType: indexOf(columns.paymentMethodType),
    transactionType: indexOf(columns.transactionType),
    settlementDate: indexOf(columns.settlementDate),
  };
  // Sin la columna llave (SOURCE_ID) no se puede emparejar nada → reporte ilegible.
  if (idx.sourceId === -1) return [];

  const credits: NormalizedCredit[] = [];
  for (const row of rows) {
    const cell = (i: number): string => (i >= 0 ? (row[i] ?? '').trim() : '');
    const sourceId = cell(idx.sourceId);
    if (!sourceId) continue; // fila vacía o sin identificador

    credits.push({
      sourceId,
      amountMinor: parseAmountToMinor(cell(idx.amount), decimalSeparator) ?? 0,
      netAmountMinor:
        parseAmountToMinor(cell(idx.netAmount), decimalSeparator) ?? 0,
      currency: cell(idx.currency) || defaultCurrency,
      paymentMethodType: cell(idx.paymentMethodType),
      transactionType: cell(idx.transactionType),
      settlementDate: toIsoOrRaw(cell(idx.settlementDate)),
    });
  }
  return credits;
}

/** Parsea un monto con separador decimal conocido a unidades menores (entero). */
export function parseAmountToMinor(
  raw: string,
  decimalSeparator: '.' | ',',
): number | null {
  const value = raw.trim();
  if (!value) return null;
  const negative = value.startsWith('-') || /^\(.*\)$/.test(value);
  const parts = value.split(decimalSeparator);
  const fracRaw = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  const intRaw =
    parts.length > 1 ? parts.slice(0, -1).join('') : (parts[0] ?? '');
  const intDigits = intRaw.replace(/\D/g, '');
  const fracDigits = fracRaw.replace(/\D/g, '');
  if (intDigits === '' && fracDigits === '') return null;
  const cents = `${fracDigits}00`.slice(0, 2);
  const minor = Number(intDigits || '0') * 100 + Number(cents);
  return negative ? -minor : minor;
}

/** Tokeniza CSV (RFC4180): campos entrecomillados, comas internas, `""` escapado, CRLF/LF. */
function tokenizeCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  // Última fila si el archivo no termina en salto de línea.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Normaliza la fecha a ISO si es parseable; si no, devuelve el valor tal cual (para ordenar). */
function toIsoOrRaw(value: string): string {
  if (!value) return '';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}
