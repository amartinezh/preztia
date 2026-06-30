import { randomUUID } from 'node:crypto';
import { IncomingCreditDrizzleRepository } from './incoming-credit.repository';
import { BankAccountDrizzleRepository } from '../cash/bank-account.repository';
import { BankCredentialDrizzleRepository } from '../cash/bank-credential.repository';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';
import type { NormalizedCredit } from '@preztiaos/domain';

// Integración del almacén de créditos (ground truth) contra Postgres real (RLS): idempotencia
// de ingestión por SOURCE_ID (I4), listado de no consumidos y consumo atómico (I1).
const describeDb = hasDb() ? describe : describe.skip;

const repo = new IncomingCreditDrizzleRepository();
const accounts = new BankAccountDrizzleRepository(
  new BankCredentialDrizzleRepository(),
);

function credit(overrides: Partial<NormalizedCredit> = {}): NormalizedCredit {
  return {
    sourceId: `src-${randomUUID()}`,
    amountMinor: 12345,
    netAmountMinor: 12345,
    currency: 'BRL',
    paymentMethodType: 'bank_transfer',
    transactionType: 'payment',
    settlementDate: '2026-06-10T12:00:00.000Z',
    ...overrides,
  };
}

describeDb('IncomingCredit (integración)', () => {
  const tenants: string[] = [];
  function newTenant(): string {
    const id = randomUUID();
    tenants.push(id);
    return id;
  }

  async function newAccount(tenantId: string): Promise<string> {
    const acc = await accounts.create(tenantId, {
      label: 'Mercado Pago',
      bankName: 'Mercado Pago',
      countryCode: 'BR',
      bankCode: 'MERCADOPAGO',
      providerType: 'MERCADOPAGO',
    });
    return acc.id;
  }

  async function newPayment(tenantId: string): Promise<string> {
    const [row] = await owner()`
      INSERT INTO payment (tenant_id, payer_phone, currency)
      VALUES (${tenantId}, '5511999999999', 'BRL') RETURNING id`;
    return row.id as string;
  }

  afterAll(async () => {
    for (const t of tenants) await cleanupTenant(t);
    await closeOwner();
  });

  it('ingesta idempotente por source_id: reingestar el mismo reporte no duplica (I4)', async () => {
    const tenant = newTenant();
    const bankAccountId = await newAccount(tenant);
    const batch = [credit({ sourceId: 'S1' }), credit({ sourceId: 'S2' })];

    const first = await repo.ingestMany({
      tenantId: tenant,
      bankAccountId,
      credits: batch,
    });
    expect(first.ingested).toBe(2);

    // Reingesta del mismo lote + uno nuevo → solo el nuevo entra.
    const second = await repo.ingestMany({
      tenantId: tenant,
      bankAccountId,
      credits: [...batch, credit({ sourceId: 'S3' })],
    });
    expect(second.ingested).toBe(1);

    const [{ count }] =
      await owner()`SELECT count(*)::int AS count FROM incoming_credit WHERE tenant_id = ${tenant}`;
    expect(count).toBe(3);
  });

  it('listUnconsumed devuelve los créditos normalizados aún disponibles', async () => {
    const tenant = newTenant();
    const bankAccountId = await newAccount(tenant);
    await repo.ingestMany({
      tenantId: tenant,
      bankAccountId,
      credits: [credit({ sourceId: 'U1', amountMinor: 5000 })],
    });

    const list = await repo.listUnconsumed({ tenantId: tenant, bankAccountId });
    expect(list).toHaveLength(1);
    expect(list[0]?.sourceId).toBe('U1');
    expect(list[0]?.amountMinor).toBe(5000);
    expect(new Date(list[0].settlementDate).toISOString()).toBe(
      '2026-06-10T12:00:00.000Z',
    );
  });

  it('markConsumed es atómico: el segundo intento no vuelve a consumir (I1)', async () => {
    const tenant = newTenant();
    const bankAccountId = await newAccount(tenant);
    await repo.ingestMany({
      tenantId: tenant,
      bankAccountId,
      credits: [credit({ sourceId: 'C1' })],
    });
    const paymentA = await newPayment(tenant);
    const paymentB = await newPayment(tenant);

    expect(
      await repo.markConsumed({
        tenantId: tenant,
        sourceId: 'C1',
        paymentId: paymentA,
      }),
    ).toBe(true);
    expect(
      await repo.markConsumed({
        tenantId: tenant,
        sourceId: 'C1',
        paymentId: paymentB,
      }),
    ).toBe(false);

    // Ya consumido → no aparece como disponible.
    const list = await repo.listUnconsumed({ tenantId: tenant, bankAccountId });
    expect(list).toHaveLength(0);
  });

  it('RLS: los créditos de un tenant no son visibles bajo otro tenant', async () => {
    const tenantA = newTenant();
    const tenantB = newTenant();
    const accountA = await newAccount(tenantA);
    await repo.ingestMany({
      tenantId: tenantA,
      bankAccountId: accountA,
      credits: [credit({ sourceId: 'A1' })],
    });

    // Bajo el contexto de B, la RLS oculta los créditos de A.
    const leaked = await repo.listUnconsumed({
      tenantId: tenantB,
      bankAccountId: accountA,
    });
    expect(leaked).toHaveLength(0);
  });
});
