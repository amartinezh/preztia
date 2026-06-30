import { E2EWellFormedRule } from './payment-antifraud.service';
import type { PaymentAntifraudInput } from '@preztiaos/application';
import type { PixReceiptData } from '@preztiaos/domain';

// Solo se prueba E2EWellFormedRule: es PURA (no toca BD). Las reglas con BD (Sha256Reuse,
// DuplicateEndToEnd, ReceiverMatch) se cubren con domain tests + integración. La lógica de
// estructura del E2E ya está cubierta por los domain tests de analyzeE2EId; aquí se verifica
// el mapeo análisis → hallazgo (rechazo vs sospecha blanda vs sin hallazgo).

function pix(endToEndId: string | null): PixReceiptData {
  return {
    amountMinor: 1000,
    currency: 'BRL',
    paidAt: '2024-01-01T12:30:00Z',
    payerName: 'Pagador',
    payerTaxId: null,
    payerBankName: null,
    receiverName: 'Preztia LTDA',
    receiverPixKey: 'pix@preztia.com',
    endToEndId,
    txid: null,
    raw: {},
  };
}

function input(endToEndId: string | null): PaymentAntifraudInput {
  return {
    tenantId: '00000000-0000-0000-0000-000000000000',
    sha256: 'abc',
    pix: pix(endToEndId),
    receivedAt: '2026-06-29T00:00:00Z',
    payerPhone: '5511999999999',
  };
}

const rule = new E2EWellFormedRule();
// E2E bien formado, ISPB conocido (Mercado Pago) y fecha pasada (no futura).
const VALID_KNOWN = 'E10573521202401011230ABCDEF01234';

describe('E2EWellFormedRule', () => {
  it('no penaliza un E2E bien formado de un ISPB conocido', async () => {
    expect(await rule.evaluate(input(VALID_KNOWN))).toBeNull();
  });

  it('RECHAZA un E2E malformado', async () => {
    const finding = await rule.evaluate(input('E10573521202401011230ABC'));
    expect(finding?.rejects).toBe(true);
    expect(finding?.reasons[0]).toContain('malformado');
  });

  it('marca sospecha blanda (no rechaza) si el ISPB tiene forma válida pero es desconocido', async () => {
    const finding = await rule.evaluate(
      input('E99999999202401011230ABCDEF01234'),
    );
    expect(finding?.rejects).toBe(false);
    expect(finding?.reasons[0]).toContain('99999999');
  });

  it('marca sospecha blanda si el comprobante no trae E2E', async () => {
    const finding = await rule.evaluate(input(null));
    expect(finding?.rejects).toBe(false);
    expect(finding?.reasons[0]).toContain('end-to-end');
  });
});
