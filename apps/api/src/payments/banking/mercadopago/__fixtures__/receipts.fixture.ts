import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PixReceiptData } from '@preztiaos/domain';

// FIXTURES sintéticos del validador antifraude PIX (Mercado Pago). Fuente única de verdad de los
// casos documentados; los usan el spec de demostración y el seed de demo. NINGUNA credencial real.
//
// El sandbox de MP devuelve reportes vacíos, así que el "ground truth" se simula con este CSV.

/** CSV sintético del settlement_report, consistente con los casos de abajo (ver expected). */
export const SETTLEMENT_REPORT_CSV = readFileSync(
  join(__dirname, 'settlement-report.sample.csv'),
  'utf8',
);

/** Identidad recaudadora configurada del tenant (contra la que se hace el match de recebedor). */
export const RECEIVER_IDENTITY = {
  pixKey: 'pix@preztia.com',
  taxId: '12345678000199',
  name: 'Preztia LTDA',
} as const;

// E2E bien formado: E + ISPB Mercado Pago (10573521) + yyyyMMddHHmm + 11 alfanuméricos = 32.
const E2E_VALID_1 = 'E10573521202606101230AAAAAAAAAAA';
const E2E_VALID_5 = 'E10573521202606110930BBBBBBBBBBB';
const E2E_VALID_6 = 'E10573521202606120800CCCCCCCCCCC';

/** Veredicto esperado de la Fase 1 (síncrona) y, si llega, de la Fase 2 (ground truth). */
export interface ReceiptExpectation {
  readonly phase1: 'pass' | 'reject';
  readonly reason: string;
  readonly phase2?: 'CONFIRMED' | 'UNCONFIRMED';
}

export interface ReceiptFixture {
  readonly key: string;
  readonly description: string;
  readonly pix: PixReceiptData;
  readonly expected: ReceiptExpectation;
}

function pix(overrides: Partial<PixReceiptData>): PixReceiptData {
  return {
    amountMinor: 0,
    currency: 'BRL',
    paidAt: '2026-06-10T12:30:00.000Z',
    payerName: 'Cliente Pagador',
    payerTaxId: '98765432100',
    payerBankName: 'Nubank',
    receiverName: RECEIVER_IDENTITY.name,
    receiverPixKey: RECEIVER_IDENTITY.pixKey,
    endToEndId: null,
    txid: null,
    raw: {},
    ...overrides,
  };
}

export const RECEIPT_FIXTURES: readonly ReceiptFixture[] = [
  {
    key: 'valido',
    description:
      'E2E bien formado, recebedor correcto y monto con crédito real → CONFIRMED',
    pix: pix({ endToEndId: E2E_VALID_1, amountMinor: 10000 }),
    expected: { phase1: 'pass', reason: 'todo coincide', phase2: 'CONFIRMED' },
  },
  {
    key: 'e2e_malformado',
    description: 'E2E con longitud/estructura inválida → REJECT en Fase 1',
    pix: pix({ endToEndId: 'E10573521-INVALIDO', amountMinor: 10000 }),
    expected: { phase1: 'reject', reason: 'E2E malformado' },
  },
  {
    key: 'e2e_reusado',
    description:
      'Mismo E2E que "valido" → REJECT por reutilización (dedup en BD)',
    pix: pix({ endToEndId: E2E_VALID_1, amountMinor: 10000 }),
    expected: { phase1: 'reject', reason: 'E2E ya visto' },
  },
  {
    key: 'recebedor_erroneo',
    description:
      'La llave PIX del recibo no es la recaudadora → REJECT en Fase 1',
    pix: pix({
      endToEndId: E2E_VALID_5,
      amountMinor: 40000,
      receiverPixKey: 'estranho@outrobanco.com',
      receiverName: 'Outra Empresa',
    }),
    expected: { phase1: 'reject', reason: 'recebedor no coincide' },
  },
  {
    key: 'monto_matchea',
    description:
      'Fase 1 pasa y hay un crédito real del mismo monto → CONFIRMED',
    pix: pix({ endToEndId: E2E_VALID_5, amountMinor: 20000 }),
    expected: {
      phase1: 'pass',
      reason: 'monto con crédito',
      phase2: 'CONFIRMED',
    },
  },
  {
    key: 'monto_sin_match',
    description:
      'Comprobante "falso perfecto": Fase 1 pasa pero NO hay crédito real → UNCONFIRMED',
    pix: pix({ endToEndId: E2E_VALID_6, amountMinor: 30000 }),
    expected: {
      phase1: 'pass',
      reason: 'sin crédito real',
      phase2: 'UNCONFIRMED',
    },
  },
];

/** Busca un fixture por su key (para los specs y el seed). */
export function receiptFixture(key: string): ReceiptFixture {
  const found = RECEIPT_FIXTURES.find((r) => r.key === key);
  if (!found) throw new Error(`Fixture de recibo desconocido: ${key}`);
  return found;
}
