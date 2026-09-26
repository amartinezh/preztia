import { randomUUID } from 'node:crypto';
import { ConflictError } from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { CashPaymentDrizzleRepository } from '../payments/cash-payment.repository';
import { CreditDrizzleRepository } from '../credit/credit.repository';
import { tenantStorage } from '../tenancy/tenant-context';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Integración de la Fase 1 del plan de control de campo y liquidación
// (docs/PLAN_CONTROL_CAMPO_Y_LIQUIDACION.md): el efectivo entra a la caja de ruta, el
// otorgamiento directo debita su caja, la zona hija usa la caja del padre y cada abono se
// desglosa en capital/interés. Contra Postgres real con RLS (rol `app`).
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const cashPayments = new CashPaymentDrizzleRepository();
const credits = new CreditDrizzleRepository();

const CURRENCY = 'COP';
const PRINCIPAL = 1000;
// 20% plano → total 1.200 en 2 cuotas de 600.
const INSTALLMENT_DUE = 600;

interface Fixture {
  tenant: string;
  zoneNorte: string;
  zoneNorteCentro: string;
  zoneSur: string;
  collector: string;
  coordinator: string;
}

interface LedgerRow {
  cash_box_id: string;
  kind: string;
  zone_id: string | null;
  collector_id: string | null;
}

async function seedFixture(): Promise<Fixture> {
  const sql = owner();
  const f: Fixture = {
    tenant: randomUUID(),
    zoneNorte: randomUUID(),
    zoneNorteCentro: randomUUID(),
    zoneSur: randomUUID(),
    collector: randomUUID(),
    coordinator: randomUUID(),
  };
  await sql`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name) VALUES
    (${f.zoneNorte}, ${f.tenant}, NULL, 'norte', 'Norte'),
    (${f.zoneNorteCentro}, ${f.tenant}, ${f.zoneNorte}, 'norte.centro', 'Centro'),
    (${f.zoneSur}, ${f.tenant}, NULL, 'sur', 'Sur')`;
  await sql`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths) VALUES
    (${f.collector}, ${f.tenant}, ${`cob-${f.collector}@t.test`}, 'x', 'COLLECTOR', ${['norte']}),
    (${f.coordinator}, ${f.tenant}, ${`coord-${f.coordinator}@t.test`}, 'x', 'COORDINATOR', ${['norte']})`;
  return f;
}

/** Deposita saldo inicial en una caja (asiento de siembra, fuera del código bajo prueba). */
async function fund(tenant: string, boxId: string, amountMinor: number) {
  await owner()`
    INSERT INTO cash_transaction (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
    VALUES (${tenant}, ${boxId}, 'IN', 'ADJUSTMENT', ${amountMinor}, ${CURRENCY}, 'saldo inicial de prueba')`;
}

async function grant(f: Fixture, zoneId: string, cashBoxId: string) {
  const id = randomUUID();
  await tenantStorage.run({ tenantId: f.tenant }, () =>
    credits.save(
      {
        id,
        tenantId: f.tenant,
        borrowerId: randomUUID(),
        zoneId,
        principalMinor: PRINCIPAL,
        interestPct: 200,
        installmentsCount: 2,
        frequency: 'DAILY',
        currency: CURRENCY,
        startDate: '2026-09-25',
        endDate: '2026-09-27',
      },
      [
        { seq: 1, amountDueMinor: INSTALLMENT_DUE, dueDate: '2026-09-26' },
        { seq: 2, amountDueMinor: INSTALLMENT_DUE, dueDate: '2026-09-27' },
      ],
      { cashBoxId, grantedBy: f.coordinator },
    ),
  );
  return id;
}

async function balance(boxId: string): Promise<number> {
  const [row] = await owner()`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END), 0)::bigint AS b
    FROM cash_transaction WHERE cash_box_id = ${boxId}`;
  return Number(row.b);
}

describeDb('Fase 1 — libro de campo (integración)', () => {
  const fixtures: Fixture[] = [];

  async function setup(): Promise<Fixture> {
    const f = await seedFixture();
    fixtures.push(f);
    return f;
  }

  afterAll(async () => {
    const sql = owner();
    for (const f of fixtures) {
      await cleanupTenant(f.tenant);
      await sql`DELETE FROM app_user WHERE tenant_id = ${f.tenant}`;
      await sql`DELETE FROM zone WHERE tenant_id = ${f.tenant}`;
    }
    await closeOwner();
  });

  it('el otorgamiento directo debita la caja y sella la zona del crédito', async () => {
    const f = await setup();
    const office = await boxes.create(f.tenant, {
      type: 'CASH',
      name: 'Oficina Norte',
      zoneId: f.zoneNorte,
    });
    await fund(f.tenant, office.id, 5000);

    const creditId = await grant(f, f.zoneNorte, office.id);

    expect(await balance(office.id)).toBe(5000 - PRINCIPAL);
    const rows = (await owner()`
      SELECT cash_box_id, kind, zone_id, collector_id FROM cash_transaction
      WHERE credit_id = ${creditId}`) as unknown as LedgerRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'DISBURSEMENT',
      zone_id: f.zoneNorte,
    });
  });

  it('sin saldo no hay crédito ni cronograma', async () => {
    const f = await setup();
    const office = await boxes.create(f.tenant, {
      type: 'CASH',
      name: 'Vacía',
    });
    await fund(f.tenant, office.id, PRINCIPAL - 1);

    await expect(grant(f, f.zoneNorte, office.id)).rejects.toThrow();

    const [{ n }] =
      await owner()`SELECT count(*)::int AS n FROM credit WHERE tenant_id = ${f.tenant}`;
    expect(n).toBe(0);
    expect(await balance(office.id)).toBe(PRINCIPAL - 1);
  });

  it('la zona hija usa la caja del padre; una zona hermana no', async () => {
    const f = await setup();
    const office = await boxes.create(f.tenant, {
      type: 'CASH',
      name: 'Oficina Norte',
      zoneId: f.zoneNorte,
    });
    await fund(f.tenant, office.id, 10_000);

    await expect(grant(f, f.zoneNorteCentro, office.id)).resolves.toBeDefined();

    const denied = grant(f, f.zoneSur, office.id);
    await expect(denied).rejects.toBeInstanceOf(ConflictError);
    await expect(denied).rejects.toMatchObject({
      code: 'BOX_NOT_USABLE_BY_ZONE',
    });
  });

  it('el cobro en efectivo entra a la caja de ruta, es idempotente y se desglosa', async () => {
    const f = await setup();
    const office = await boxes.create(f.tenant, {
      type: 'CASH',
      name: 'Oficina',
    });
    await fund(f.tenant, office.id, 5000);
    const route = await boxes.create(f.tenant, {
      type: 'CASH',
      name: 'Ruta cob',
      assignedTo: f.collector,
      zoneId: f.zoneNorte,
    });
    const creditId = await grant(f, f.zoneNorteCentro, office.id);
    const idempotencyKey = randomUUID();

    const pay = () =>
      cashPayments.register({
        tenantId: f.tenant,
        creditId,
        amountMinor: INSTALLMENT_DUE,
        idempotencyKey,
        receivedBy: f.collector,
      });
    const first = await pay();
    await pay();

    expect(await balance(route.id)).toBe(INSTALLMENT_DUE);
    const rows = (await owner()`
      SELECT cash_box_id, kind, zone_id, collector_id FROM cash_transaction
      WHERE payment_id = ${first!.id}`) as unknown as LedgerRow[];
    expect(rows).toEqual([
      {
        cash_box_id: route.id,
        kind: 'PAYMENT_IN',
        // La zona sellada es la del CRÉDITO, no la de la caja de ruta.
        zone_id: f.zoneNorteCentro,
        collector_id: f.collector,
      },
    ]);

    const [split] = await owner()`
      SELECT principal_minor, interest_minor FROM payment_allocation WHERE payment_id = ${first!.id}`;
    // 600 de 1.200 con capital 1.000 → capital 500, interés 100.
    expect(Number(split.principal_minor)).toBe(500);
    expect(Number(split.interest_minor)).toBe(100);
  });

  it('sin caja de ruta no se recibe efectivo y nada queda registrado', async () => {
    const f = await setup();
    const office = await boxes.create(f.tenant, {
      type: 'CASH',
      name: 'Oficina',
    });
    await fund(f.tenant, office.id, 5000);
    const creditId = await grant(f, f.zoneNorte, office.id);

    const attempt = cashPayments.register({
      tenantId: f.tenant,
      creditId,
      amountMinor: INSTALLMENT_DUE,
      idempotencyKey: null,
      receivedBy: f.collector,
    });
    await expect(attempt).rejects.toMatchObject({ code: 'NO_ROUTE_CASH_BOX' });

    const [{ n }] =
      await owner()`SELECT count(*)::int AS n FROM payment WHERE tenant_id = ${f.tenant}`;
    expect(n).toBe(0);
    const [{ paid }] = await owner()`
      SELECT COALESCE(SUM(paid_minor), 0)::int AS paid FROM installment WHERE credit_id = ${creditId}`;
    expect(paid).toBe(0);
  });
});
