import { randomUUID } from 'node:crypto';
import { RegisterMigratedCreditHandler } from '@preztiaos/application';
import { businessDateOf } from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from '../cash/cash-box.repository';
import { CashPaymentDrizzleRepository } from '../payments/cash-payment.repository';
import { SettlementRepository } from '../settlements/settlement.repository';
import { MigratedCreditRepository } from './migrated-credit.repository';
import {
  owner,
  cleanupTenant,
  closeOwner,
  hasDb,
  seedBorrower,
} from '../../test/db-helpers';

// Carga de créditos migrados del sistema anterior contra Postgres real con RLS: la deuda y sus
// abonos históricos quedan en la cartera, pero NO en el libro de cajas ni en el resultado del
// período (no se prestó ni se cobró hoy). Los abonos nuevos sobre un migrado sí cuentan.
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const cashPayments = new CashPaymentDrizzleRepository();
const settlements = new SettlementRepository();
const migrate = new RegisterMigratedCreditHandler(
  new MigratedCreditRepository(),
);

const CURRENCY = 'COP';
const TIME_ZONE = 'America/Bogota';
const DAY_MS = 24 * 60 * 60 * 1000;
const dayAgo = (n: number) =>
  businessDateOf(new Date(Date.now() - n * DAY_MS), TIME_ZONE);

interface Fixture {
  tenant: string;
  zone: string;
  collector: string;
  borrower: string;
}

async function seed(): Promise<Fixture> {
  const db = owner();
  const tenant = randomUUID();
  const zone = randomUUID();
  const collector = randomUUID();
  await db`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name) VALUES (${zone}, ${tenant}, NULL, 'norte', 'Norte')`;
  await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths)
    VALUES (${collector}, ${tenant}, ${`c-${collector}@t.test`}, 'x', 'COLLECTOR', ${['norte']})`;
  await boxes.create(tenant, {
    type: 'CASH',
    name: 'Ruta',
    assignedTo: collector,
    zoneId: zone,
  });
  return { tenant, zone, collector, borrower: await seedBorrower(tenant) };
}

const load = (f: Fixture, legacyReference: string | null = 'LEG-1') =>
  migrate.execute({
    tenantId: f.tenant,
    borrowerId: f.borrower,
    zoneId: f.zone,
    principalMinor: 100_000,
    interestPct: 200,
    installmentsCount: 4,
    frequency: 'WEEKLY',
    currency: CURRENCY,
    startDate: dayAgo(40),
    legacyReference,
    payments: [
      { paidOn: dayAgo(30), amountMinor: 30_000 },
      { paidOn: dayAgo(20), amountMinor: 20_000 },
    ],
    migratedBy: randomUUID(),
  });

describeDb('Créditos migrados (integración)', () => {
  const fixtures: Fixture[] = [];
  async function setup(): Promise<Fixture> {
    const f = await seed();
    fixtures.push(f);
    return f;
  }

  afterAll(async () => {
    const db = owner();
    for (const f of fixtures) {
      await cleanupTenant(f.tenant);
      await db`DELETE FROM borrower WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM audit_log WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM app_user WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM zone WHERE tenant_id = ${f.tenant}`;
    }
    await closeOwner();
  });

  it('carga la deuda y sus abonos históricos sin tocar el libro de cajas', async () => {
    const f = await setup();
    const result = await load(f);
    expect(result).toMatchObject({
      paidMinor: 50_000,
      balanceMinor: 70_000,
      settled: false,
    });

    const db = owner();
    const [credit] = await db<{ origin: string; start_date: string }[]>`
      SELECT origin, start_date::text FROM credit WHERE id = ${result.id}`;
    expect(credit).toMatchObject({
      origin: 'MIGRATED',
      start_date: dayAgo(40),
    });
    const installments = await db<{ paid_minor: string }[]>`
      SELECT paid_minor FROM installment WHERE credit_id = ${result.id} ORDER BY seq`;
    expect(installments.map((i) => Number(i.paid_minor))).toEqual([
      30_000, 20_000, 0, 0,
    ]);
    const payments = await db<{ historical: boolean; paid_at: Date }[]>`
      SELECT historical, paid_at FROM payment WHERE credit_id = ${result.id} ORDER BY paid_at`;
    expect(payments.every((p) => p.historical)).toBe(true);
    expect(businessDateOf(payments[0].paid_at, TIME_ZONE)).toBe(dayAgo(30));
    const [{ n }] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM cash_transaction WHERE tenant_id = ${f.tenant}`;
    expect(n).toBe(0);
    const [audit] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${f.tenant} AND action = 'MIGRATE credit'`;
    expect(audit.n).toBe(1);
  });

  it('la misma referencia del sistema anterior no se carga dos veces (409, sin efectos)', async () => {
    const f = await setup();
    await load(f, 'LEG-DUP');
    await expect(load(f, 'LEG-DUP')).rejects.toMatchObject({
      code: 'LEGACY_REFERENCE_TAKEN',
    });
    const [{ n }] = await owner()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM credit WHERE tenant_id = ${f.tenant}`;
    expect(n).toBe(1);
  });

  it('la liquidación no lo cuenta como prestado ni cobrado; un abono nuevo sí cuenta', async () => {
    const f = await setup();
    const { id } = await load(f, null);
    const current = () =>
      settlements.current({
        tenantId: f.tenant,
        currency: CURRENCY,
        scopes: null,
        now: new Date(),
      });

    const before = (await current()).snapshot.result;
    expect(before.newCreditsCount).toBe(0);
    expect(before.collectedOnPortfolioMinor).toBe(0);
    expect(before.interestEarnedMinor).toBe(0);

    await cashPayments.register({
      tenantId: f.tenant,
      creditId: id,
      amountMinor: 10_000,
      idempotencyKey: null,
      receivedBy: f.collector,
    });
    const after = (await current()).snapshot.result;
    expect(after.collectedOnPortfolioMinor).toBe(10_000);
  });
});
