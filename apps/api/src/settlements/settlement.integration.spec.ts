import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { CashBoxDrizzleRepository } from '../cash/cash-box.repository';
import { CreditDrizzleRepository } from '../credit/credit.repository';
import { CashPaymentDrizzleRepository } from '../payments/cash-payment.repository';
import { tenantStorage } from '../tenancy/tenant-context';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { SettlementRepository } from './settlement.repository';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Integración de la Fase 6 (liquidación por períodos) contra Postgres real con RLS: reconstrucción
// retroactiva en orden, encadenamiento de saldos entre períodos (I2), cuadre contra el libro (I4),
// período en vivo con el resultado del negocio, recorte por zona y aislamiento por tenant.
// Configuración por defecto: semanal de lunes a domingo, zona horaria America/Bogota.
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const credits = new CreditDrizzleRepository();
const cashPayments = new CashPaymentDrizzleRepository();
const settlements = new SettlementRepository();

const CURRENCY = 'COP';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

interface Fixture {
  tenant: string;
  office: string;
  route: string;
  collector: string;
  creditId: string;
}

async function seed(): Promise<Fixture> {
  const db = owner();
  const tenant = randomUUID();
  const zone = randomUUID();
  const collector = randomUUID();
  await db`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name) VALUES (${zone}, ${tenant}, NULL, 'norte', 'Norte')`;
  await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths)
    VALUES (${collector}, ${tenant}, ${`c-${collector}@t.test`}, 'x', 'COLLECTOR', ${['norte']})`;
  const office = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Oficina Norte',
    zoneId: zone,
  });
  const route = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Ruta',
    assignedTo: collector,
    zoneId: zone,
  });
  // Historia: fondeo hace 15 días y un retiro hace 8 días (dos semanas ya terminadas).
  await db`INSERT INTO cash_transaction (tenant_id, cash_box_id, zone_id, direction, kind, amount_minor, currency, reason, created_at)
    VALUES (${tenant}, ${office.id}, ${zone}, 'IN', 'ADJUSTMENT', 1000000, ${CURRENCY}, 'fondeo', ${daysAgo(15)}),
           (${tenant}, ${office.id}, ${zone}, 'OUT', 'WITHDRAWAL', 100000, ${CURRENCY}, 'retiro socio', ${daysAgo(8)})`;
  // Esta semana: crédito de 100.000 al 20% (desembolso) y un cobro en efectivo de 60.000.
  const creditId = randomUUID();
  await tenantStorage.run({ tenantId: tenant }, () =>
    credits.save(
      {
        id: creditId,
        tenantId: tenant,
        borrowerId: randomUUID(),
        zoneId: zone,
        principalMinor: 100_000,
        interestPct: 200,
        installmentsCount: 2,
        frequency: 'DAILY',
        currency: CURRENCY,
        startDate: '2026-01-01',
        endDate: '2026-01-03',
      },
      [
        { seq: 1, amountDueMinor: 60_000, dueDate: '2026-01-02' },
        { seq: 2, amountDueMinor: 60_000, dueDate: '2026-01-03' },
      ],
      { cashBoxId: office.id, grantedBy: randomUUID() },
    ),
  );
  await cashPayments.register({
    tenantId: tenant,
    creditId,
    amountMinor: 60_000,
    idempotencyKey: null,
    receivedBy: collector,
  });
  return { tenant, office: office.id, route: route.id, collector, creditId };
}

const close = (f: Fixture) =>
  settlements.close({
    tenantId: f.tenant,
    currency: CURRENCY,
    closedBy: null,
    now: new Date(),
  });

const snapshotOf = async (
  f: Fixture,
  id: string,
  scopes: readonly string[] | null = null,
) => (await settlements.get({ tenantId: f.tenant, id, scopes })).snapshot;

/** Saldo del libro de una caja antes de un instante (verdad contra la que cuadra la foto). */
async function ledgerBalanceBefore(
  boxId: string,
  instant: string,
): Promise<number> {
  const [row] = await owner()`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END), 0)::bigint AS b
    FROM cash_transaction WHERE cash_box_id = ${boxId} AND created_at < ${instant}::timestamptz`;
  return Number(row.b);
}

describeDb('Fase 6 — liquidación por períodos (integración)', () => {
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
      await db`DELETE FROM audit_log WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM app_user WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM zone WHERE tenant_id = ${f.tenant}`;
    }
    await closeOwner();
  });

  it('reconstruye la historia en orden, encadena saldos y cuadra con el libro; la semana en curso no se cierra', async () => {
    const f = await setup();
    const before = await settlements.current({
      tenantId: f.tenant,
      currency: CURRENCY,
      scopes: null,
      now: new Date(),
    });
    expect(before.pendingClosures).toBeGreaterThanOrEqual(2);

    const closed: string[] = [];
    for (let i = 0; i < before.pendingClosures; i++)
      closed.push(await close(f));
    await expect(close(f)).rejects.toMatchObject({ code: 'PERIOD_NOT_ENDED' });

    const views = await Promise.all(
      closed.map((id) =>
        settlements.get({ tenantId: f.tenant, id, scopes: null }),
      ),
    );
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      expect(v.retroactive).toBe(true);
      const t = v.snapshot.totals;
      expect(t.openingMinor + t.inMinor - t.outMinor).toBe(t.closingMinor); // I1
      const office = v.snapshot.boxes.find((b) => b.cashBoxId === f.office)!;
      expect(office.closingMinor).toBe(
        await ledgerBalanceBefore(f.office, v.endsAt),
      ); // I4
      if (i > 0) {
        expect(v.periodStart).toBe(views[i - 1].periodEnd); // I2: sin huecos
        expect(t.openingMinor).toBe(views[i - 1].snapshot.totals.closingMinor);
      }
    }
    const all = views.flatMap((v) =>
      v.snapshot.boxes.filter((b) => b.cashBoxId === f.office),
    );
    expect(all.reduce((acc, b) => acc + b.inMinor - b.outMinor, 0)).toBe(
      900_000,
    );
  });

  it('el período en vivo arranca en la última liquidación y trae el resultado del negocio', async () => {
    const f = await setup();
    const pending = (
      await settlements.current({
        tenantId: f.tenant,
        currency: CURRENCY,
        scopes: null,
        now: new Date(),
      })
    ).pendingClosures;
    for (let i = 0; i < pending; i++) await close(f);

    const live = await settlements.current({
      tenantId: f.tenant,
      currency: CURRENCY,
      scopes: null,
      now: new Date(),
    });
    expect(live).toMatchObject({ isOpen: true, pendingClosures: 0 });
    expect(live.snapshot.totals.concepts.DISBURSED).toBe(100_000);
    expect(live.snapshot.totals.concepts.COLLECTED).toBe(60_000);
    // 60.000 de 120.000 con capital 100.000 → capital 50.000, interés 10.000.
    expect(live.snapshot.result).toMatchObject({
      interestEarnedMinor: 10_000,
      principalRecoveredMinor: 50_000,
      utilityMinor: 10_000,
      newCreditsCount: 1,
      newCreditsPrincipalMinor: 100_000,
    });
    expect(live.snapshot.collectors[0]).toMatchObject({
      collectedMinor: 60_000,
      closingCashMinor: 60_000,
    });
  });

  it('el coordinador de otra zona no ve cajas ni cobradores de Norte', async () => {
    const f = await setup();
    const live = await settlements.current({
      tenantId: f.tenant,
      currency: CURRENCY,
      scopes: ['sur'],
      now: new Date(),
    });
    expect(live.snapshot.boxes).toHaveLength(0);
    expect(live.snapshot.collectors).toHaveLength(0);
    expect(live.snapshot.totals.openingMinor).toBe(0);
  });

  it('RLS: otro tenant no ve la foto y la app no la edita ni la borra', async () => {
    const f = await setup();
    const other = await setup();
    const id = await close(f);
    const seen = await withTenantTxFor(other.tenant, (tx) =>
      tx
        .select({ id: schema.settlementPeriod.id })
        .from(schema.settlementPeriod)
        .where(eq(schema.settlementPeriod.id, id)),
    );
    expect(seen).toHaveLength(0);
    await expect(
      withTenantTxFor(f.tenant, (tx) =>
        tx
          .update(schema.settlementPeriod)
          .set({ retroactive: false })
          .where(eq(schema.settlementPeriod.id, id)),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(snapshotOf(f, id)).resolves.toBeDefined();
  });
});
