import { randomUUID } from 'node:crypto';
import { CreditPortfolioDrizzleRepository } from './credit-portfolio.repository';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';
import type { PaymentOutcome, PaymentRecord } from '@preztiaos/application';

// Traza antifraude Fase 1 (`fraud_assessment`) contra Postgres real: `savePaymentOutcome`
// registra el veredicto (status/score/reasons) en la misma transacción que persiste el pago.
const describeDb = hasDb() ? describe : describe.skip;

const portfolios = new CreditPortfolioDrizzleRepository();

function paymentRecord(
  tenantId: string,
  overrides: Partial<PaymentRecord>,
): PaymentRecord {
  return {
    tenantId,
    creditId: null, // huérfano: no requiere cartera para esta prueba
    providerMessageId: `wamid-${randomUUID()}`,
    channelId: 'demo-channel',
    payerPhone: '5511999999999',
    amountMinor: 10000,
    currency: 'BRL',
    paidAt: '2026-06-10T12:00:00.000Z',
    payerName: 'Pagador',
    payerTaxId: null,
    payerBankName: null,
    receiverPixKey: 'pix@preztia.com',
    endToEndId: null, // null para no chocar con el índice único de E2E
    txid: null,
    extractionRaw: {},
    sha256: randomUUID(),
    storageKey: null,
    mimeType: 'image/jpeg',
    status: 'UNVERIFIED',
    bankStatus: null,
    bankResponse: null,
    fraudScore: 0,
    fraudReasons: null,
    ...overrides,
  };
}

function outcome(payment: PaymentRecord): PaymentOutcome {
  return {
    payment,
    allocations: [],
    installments: [],
    creditSettled: false,
    // savePaymentOutcome siempre persiste al menos un evento (en producción nunca viene vacío).
    events: [{ type: 'payment_received' }],
  };
}

describeDb('FraudAssessment Fase 1 (integración)', () => {
  const tenants: string[] = [];
  function newTenant(): string {
    const id = randomUUID();
    tenants.push(id);
    return id;
  }

  async function readAssessment(tenantId: string) {
    const [row] =
      await owner()`SELECT phase, status, score, reasons FROM fraud_assessment WHERE tenant_id = ${tenantId}`;
    return row;
  }

  afterAll(async () => {
    for (const t of tenants) await cleanupTenant(t);
    await closeOwner();
  });

  it('registra "suspicious" con score y motivos cuando hay señales blandas', async () => {
    const tenant = newTenant();
    await portfolios.savePaymentOutcome(
      outcome(
        paymentRecord(tenant, {
          status: 'UNVERIFIED',
          fraudScore: 60,
          fraudReasons: ['El comprobante tiene más de 7 días'],
        }),
      ),
    );
    const row = await readAssessment(tenant);
    expect(row.phase).toBe('PHASE1_SCREEN');
    expect(row.status).toBe('suspicious');
    expect(Number(row.score)).toBe(60);
    expect(row.reasons).toContain('El comprobante tiene más de 7 días');
  });

  it('registra "rejected" cuando el pago quedó REJECTED_FRAUD', async () => {
    const tenant = newTenant();
    await portfolios.savePaymentOutcome(
      outcome(
        paymentRecord(tenant, {
          status: 'REJECTED_FRAUD',
          fraudScore: 100,
          fraudReasons: ['El comprobante ya fue presentado para otro pago'],
        }),
      ),
    );
    const row = await readAssessment(tenant);
    expect(row.status).toBe('rejected');
  });

  it('registra "approved" cuando no hay señales', async () => {
    const tenant = newTenant();
    await portfolios.savePaymentOutcome(
      outcome(
        paymentRecord(tenant, {
          status: 'UNVERIFIED',
          fraudScore: 0,
          fraudReasons: null,
        }),
      ),
    );
    const row = await readAssessment(tenant);
    expect(row.status).toBe('approved');
    expect(row.reasons).toEqual([]);
  });
});
