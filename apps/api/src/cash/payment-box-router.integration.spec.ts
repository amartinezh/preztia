import { randomUUID } from 'node:crypto';
import { routeVerifiedPaymentToBox } from './payment-box-router';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { BankAccountDrizzleRepository } from './bank-account.repository';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Tests de integración del ruteo automático de pagos a caja (Req 4) contra Postgres real:
// emparejamiento por llave PIX, fallback a tránsito e idempotencia de dinero por pago.
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const accounts = new BankAccountDrizzleRepository();

interface RoutedRow {
  cash_box_id: string;
  kind: string;
}

async function insertPayment(
  tenantId: string,
  receiverPixKey: string | null,
  amountMinor: number,
): Promise<string> {
  const id = randomUUID();
  await owner()`
    INSERT INTO payment (id, tenant_id, payer_phone, amount_minor, currency, receiver_pix_key, status)
    VALUES (${id}, ${tenantId}, '5511999', ${amountMinor}, 'COP', ${receiverPixKey}, 'VERIFIED')`;
  return id;
}

async function route(
  tenantId: string,
  paymentId: string,
  receiverPixKey: string | null,
  amountMinor: number,
): Promise<void> {
  await withTenantTxFor(tenantId, (tx) =>
    routeVerifiedPaymentToBox(tx, {
      tenantId,
      paymentId,
      receiverPixKey,
      amountMinor,
      currency: 'COP',
      createdBy: null,
    }),
  );
}

async function routedRows(paymentId: string): Promise<RoutedRow[]> {
  return owner()`
    SELECT cash_box_id, kind FROM cash_transaction WHERE payment_id = ${paymentId}` as unknown as Promise<
    RoutedRow[]
  >;
}

describeDb('routeVerifiedPaymentToBox (integración)', () => {
  const tenants: string[] = [];
  function newTenant(): string {
    const id = randomUUID();
    tenants.push(id);
    return id;
  }

  afterAll(async () => {
    for (const t of tenants) await cleanupTenant(t);
    await closeOwner();
  });

  it('empareja la llave PIX y postea PAYMENT_IN en la caja bancaria', async () => {
    const tenant = newTenant();
    const account = await accounts.create(tenant, {
      label: 'Inter',
      bankName: 'Inter',
      countryCode: 'BR',
      bankCode: 'INTER',
      pixKey: 'pix@preztia.test',
    });
    const bankBox = await boxes.create(tenant, {
      type: 'BANK',
      name: 'Caja Inter',
      bankAccountId: account.id,
    });
    const paymentId = await insertPayment(tenant, 'pix@preztia.test', 25000);

    await route(tenant, paymentId, 'pix@preztia.test', 25000);

    const rows = await routedRows(paymentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('PAYMENT_IN');
    expect(rows[0].cash_box_id).toBe(bankBox.id);
  });

  it('sin caja para la llave PIX, va a la caja de tránsito (autoprovisionada)', async () => {
    const tenant = newTenant();
    const paymentId = await insertPayment(tenant, null, 5000);

    await route(tenant, paymentId, null, 5000);

    const rows = await routedRows(paymentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('UNIDENTIFIED');

    const [box] =
      await owner()`SELECT type FROM cash_box WHERE id = ${rows[0].cash_box_id}`;
    expect(box.type).toBe('TRANSIT');
  });

  it('es idempotente: rutear el mismo pago dos veces deja un solo asiento', async () => {
    const tenant = newTenant();
    const paymentId = await insertPayment(tenant, null, 7000);

    await route(tenant, paymentId, null, 7000);
    await route(tenant, paymentId, null, 7000);

    const rows = await routedRows(paymentId);
    expect(rows).toHaveLength(1);
  });
});
