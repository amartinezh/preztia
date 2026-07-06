import { randomUUID } from 'node:crypto';
import { RunSettlementReconciliationService } from './run-settlement-reconciliation.service';
import { IncomingCreditDrizzleRepository } from './incoming-credit.repository';
import { PaymentReconciliationDrizzleRepository } from './payment-reconciliation.repository';
import { ManualVerifyPaymentRepository } from './manual-verify-payment.repository';
import type { SettlementReviewSettingsReader } from './settlement-review-settings.reader';
import { BankAccountDrizzleRepository } from '../cash/bank-account.repository';
import { BankCredentialDrizzleRepository } from '../cash/bank-credential.repository';
import { parseSettlementCsv } from './banking/mercadopago/mp-report-csv.parser';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';
import type { SettlementSource } from '@preztiaos/application';
import type { OutboundTextSender } from '@preztiaos/application';

// Ciclo COMPLETO de la Fase 2 contra Postgres real, con fixtures CSV sintéticos (el sandbox de
// MP devuelve reportes vacíos): CSV → ingest → match por monto único → confirmación atómica.
// Incluye el caso estrella "comprobante falso perfecto" → UNCONFIRMED por ausencia de crédito.
const describeDb = hasDb() ? describe : describe.skip;

const accounts = new BankAccountDrizzleRepository(
  new BankCredentialDrizzleRepository(),
);
const credits = new IncomingCreditDrizzleRepository();
const reconciliation = new PaymentReconciliationDrizzleRepository();
const noopSender = {
  sendText: () => Promise.resolve(),
} as unknown as OutboundTextSender;

const HEADER =
  'SOURCE_ID,TRANSACTION_AMOUNT,SETTLEMENT_NET_AMOUNT,TRANSACTION_CURRENCY,PAYMENT_METHOD_TYPE,TRANSACTION_TYPE,SETTLEMENT_DATE';

/** Fuente de liquidación falsa: devuelve los créditos parseados de un CSV fixture. */
function sourceFromCsv(csv: string): SettlementSource {
  return { fetchCredits: () => Promise.resolve(parseSettlementCsv(csv)) };
}

/** Lector del toggle stubbeado (ON = abono automático; OFF = reserva para revisión humana). */
function settingsReader(autoConfirm: boolean): SettlementReviewSettingsReader {
  return {
    autoConfirm: () => Promise.resolve(autoConfirm),
  };
}

/** Construye el servicio con el toggle dado (default de los tests: ON = abono automático). */
function buildService(
  csv: string,
  autoConfirm = true,
): RunSettlementReconciliationService {
  return new RunSettlementReconciliationService(
    sourceFromCsv(csv),
    credits,
    reconciliation,
    noopSender,
    settingsReader(autoConfirm),
  );
}

describeDb('RunSettlementReconciliation (ciclo completo, integración)', () => {
  const tenants: string[] = [];
  function newTenant(): string {
    const id = randomUUID();
    tenants.push(id);
    return id;
  }

  async function seedAccount(tenantId: string): Promise<void> {
    await accounts.create(tenantId, {
      label: 'Mercado Pago',
      bankName: 'Mercado Pago',
      countryCode: 'BR',
      bankCode: 'MERCADOPAGO',
      providerType: 'MERCADOPAGO',
      pixKey: 'pix@preztia.com',
    });
  }

  /** Crédito ACTIVO con una sola cuota por `amountMinor`. Devuelve {creditId, installmentId}. */
  async function seedCreditWithInstallment(
    tenantId: string,
    amountMinor: number,
  ): Promise<{ creditId: string }> {
    const [credit] = await owner()`
      INSERT INTO credit (tenant_id, borrower_id, zone_id, principal_minor, interest_pct,
        installments_count, currency, start_date, end_date, status)
      VALUES (${tenantId}, ${randomUUID()}, ${randomUUID()}, ${amountMinor}, 0, 1, 'BRL',
        '2026-06-01', '2026-07-01', 'ACTIVE') RETURNING id`;
    await owner()`
      INSERT INTO installment (tenant_id, credit_id, seq, due_date, amount_due_minor, paid_minor, status)
      VALUES (${tenantId}, ${credit.id}, 1, '2026-06-10', ${amountMinor}, 0, 'PENDING')`;
    return { creditId: credit.id as string };
  }

  /** Comprobante PIX pendiente (UNVERIFIED) por `amountMinor`, ligado a un crédito. */
  async function seedPendingPayment(
    tenantId: string,
    amountMinor: number,
    creditId: string,
  ): Promise<string> {
    const [row] = await owner()`
      INSERT INTO payment (tenant_id, payer_phone, currency, amount_minor, status, credit_id, receiver_pix_key)
      VALUES (${tenantId}, '5511999999999', 'BRL', ${amountMinor}, 'UNVERIFIED', ${creditId}, 'pix@preztia.com')
      RETURNING id`;
    return row.id as string;
  }

  afterAll(async () => {
    for (const t of tenants) await cleanupTenant(t);
    await closeOwner();
  });

  it('CONFIRMA el pago cuando un crédito real del reporte matchea por monto único', async () => {
    const tenant = newTenant();
    await seedAccount(tenant);
    const amount = 12345;
    const { creditId } = await seedCreditWithInstallment(tenant, amount);
    const paymentId = await seedPendingPayment(tenant, amount, creditId);

    const csv = [
      HEADER,
      `SRC-OK,123.45,123.45,BRL,bank_transfer,payment,2026-06-10T12:00:00Z`,
      `SRC-CARD,123.45,123.45,BRL,credit_card,payment,2026-06-10T12:00:00Z`, // no PIX → ignorado
    ].join('\n');
    const service = buildService(csv);

    const summary = await service.execute({ tenantId: tenant });
    expect(summary.confirmed).toBe(1);

    const [pay] =
      await owner()`SELECT status FROM payment WHERE id = ${paymentId}`;
    expect(pay.status).toBe('VERIFIED');

    const [inst] =
      await owner()`SELECT paid_minor, status FROM installment WHERE credit_id = ${creditId}`;
    expect(Number(inst.paid_minor)).toBe(amount);
    expect(inst.status).toBe('PAID');

    const [credit] =
      await owner()`SELECT status FROM credit WHERE id = ${creditId}`;
    expect(credit.status).toBe('SETTLED');

    const [consumed] =
      await owner()`SELECT consumed_by_payment_id FROM incoming_credit WHERE tenant_id = ${tenant} AND source_id = 'SRC-OK'`;
    expect(consumed.consumed_by_payment_id).toBe(paymentId);

    // Traza antifraude Fase 2: una evaluación CONFIRMED quedó registrada para el pago.
    const [assessment] =
      await owner()`SELECT phase, status FROM fraud_assessment WHERE payment_id = ${paymentId}`;
    expect(assessment.phase).toBe('PHASE2_SETTLEMENT');
    expect(assessment.status).toBe('CONFIRMED');
  });

  it('comprobante FALSO PERFECTO: sin crédito real que matchee → queda UNCONFIRMED', async () => {
    const tenant = newTenant();
    await seedAccount(tenant);
    const amount = 99999;
    const { creditId } = await seedCreditWithInstallment(tenant, amount);
    const paymentId = await seedPendingPayment(tenant, amount, creditId);

    // El reporte trae un crédito real pero de OTRO monto (no matchea el comprobante falso).
    const csv = [
      HEADER,
      `SRC-OTHER,111.11,111.11,BRL,bank_transfer,payment,2026-06-10T12:00:00Z`,
    ].join('\n');
    const service = buildService(csv);

    const summary = await service.execute({ tenantId: tenant });
    expect(summary.confirmed).toBe(0);
    expect(summary.unconfirmed).toBeGreaterThanOrEqual(1);

    const [pay] =
      await owner()`SELECT status FROM payment WHERE id = ${paymentId}`;
    expect(pay.status).toBe('UNVERIFIED'); // NO se liberó
  });

  it('es idempotente: una segunda corrida no re-confirma ni re-abona', async () => {
    const tenant = newTenant();
    await seedAccount(tenant);
    const amount = 54321;
    const { creditId } = await seedCreditWithInstallment(tenant, amount);
    await seedPendingPayment(tenant, amount, creditId);

    const csv = [
      HEADER,
      `SRC-IDEM,543.21,543.21,BRL,bank_transfer,payment,2026-06-10T12:00:00Z`,
    ].join('\n');
    const service = buildService(csv);

    expect((await service.execute({ tenantId: tenant })).confirmed).toBe(1);
    // Segunda corrida: el pago ya está VERIFIED (no es pendiente) → nada que confirmar.
    expect((await service.execute({ tenantId: tenant })).confirmed).toBe(0);

    const [inst] =
      await owner()`SELECT paid_minor FROM installment WHERE credit_id = ${creditId}`;
    expect(Number(inst.paid_minor)).toBe(amount); // no se abonó dos veces
  });

  it('toggle OFF: un match RESERVA el crédito y deja el pago pendiente de aprobación (no abona)', async () => {
    const tenant = newTenant();
    await seedAccount(tenant);
    const amount = 70000;
    const { creditId } = await seedCreditWithInstallment(tenant, amount);
    const paymentId = await seedPendingPayment(tenant, amount, creditId);

    const csv = [
      HEADER,
      `SRC-REV,700.00,700.00,BRL,bank_transfer,payment,2026-06-10T12:00:00Z`,
    ].join('\n');
    // autoConfirm=false → conciliación manual.
    const summary = await buildService(csv, false).execute({
      tenantId: tenant,
    });
    expect(summary.confirmed).toBe(0);
    expect(summary.pendingReview).toBe(1);

    // El pago NO se abonó: sigue UNVERIFIED y la cuota en cero.
    const [pay] =
      await owner()`SELECT status FROM payment WHERE id = ${paymentId}`;
    expect(pay.status).toBe('UNVERIFIED');
    const [inst] =
      await owner()`SELECT paid_minor FROM installment WHERE credit_id = ${creditId}`;
    expect(Number(inst.paid_minor)).toBe(0);

    // El crédito quedó RESERVADO (consumido por este pago) para que no lo tome otro match.
    const [credit] =
      await owner()`SELECT consumed_by_payment_id FROM incoming_credit WHERE tenant_id = ${tenant} AND source_id = 'SRC-REV'`;
    expect(credit.consumed_by_payment_id).toBe(paymentId);

    // Traza PENDING_REVIEW registrada.
    const [assessment] =
      await owner()`SELECT status FROM fraud_assessment WHERE payment_id = ${paymentId} AND phase = 'PHASE2_SETTLEMENT'`;
    expect(assessment.status).toBe('PENDING_REVIEW');

    // Una segunda corrida NO reserva otro crédito para el mismo pago (una reserva por pago).
    const second = await buildService(csv, false).execute({ tenantId: tenant });
    expect(second.pendingReview).toBe(0);
  });

  it('conciliación manual: aprobar un pago reservado abona el monto del crédito real', async () => {
    const tenant = newTenant();
    await seedAccount(tenant);
    const amount = 80000;
    const { creditId } = await seedCreditWithInstallment(tenant, amount);
    const paymentId = await seedPendingPayment(tenant, amount, creditId);

    const csv = [
      HEADER,
      `SRC-MAN,800.00,800.00,BRL,bank_transfer,payment,2026-06-10T12:00:00Z`,
    ].join('\n');
    await buildService(csv, false).execute({ tenantId: tenant });

    // El humano aprueba (reusa el repositorio de verificación manual).
    const manual = new ManualVerifyPaymentRepository();
    const result = await manual.verify({
      tenantId: tenant,
      paymentId,
      decidedBy: randomUUID(),
      reason: 'Verificado en el extracto de PicPay',
    });
    expect(result.status).toBe('VERIFIED');

    // Se abonó el monto del crédito real (800.00) aunque no se pasó override.
    const [inst] =
      await owner()`SELECT paid_minor, status FROM installment WHERE credit_id = ${creditId}`;
    expect(Number(inst.paid_minor)).toBe(amount);
    expect(inst.status).toBe('PAID');
  });
});
