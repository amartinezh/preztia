import { randomUUID } from 'node:crypto';
import { ForbiddenError, businessDateOf } from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from '../cash/cash-box.repository';
import { CreditDrizzleRepository } from '../credit/credit.repository';
import { tenantStorage } from '../tenancy/tenant-context';
import { CashPaymentDrizzleRepository } from './cash-payment.repository';
import {
  owner,
  cleanupTenant,
  closeOwner,
  hasDb,
  seedBorrower,
} from '../../test/db-helpers';

// Pagos registrados después de cobrarlos, contra Postgres real con RLS: la FECHA DEL PAGO puede
// quedar en el pasado (captura offline o elegida a mano, con límite y bloqueo), pero el LIBRO DE
// CAJAS se fecha al registrar (ADR #41) y todo lo atrasado queda en la auditoría.
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const credits = new CreditDrizzleRepository();
const cashPayments = new CashPaymentDrizzleRepository();

const CURRENCY = 'COP';
const TIME_ZONE = 'America/Bogota';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_DAYS_BACK = 3;
const AMOUNT = 10_000;

interface Fixture {
  tenant: string;
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
  const settings = {
    blockOverdueDatesForSales: true,
    backdateMaxDays: MAX_DAYS_BACK,
  };
  await db`INSERT INTO tenant_config (tenant_id, operational_settings) VALUES (${tenant}, ${db.json(settings)})`;
  const office = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Oficina',
    zoneId: zone,
  });
  await boxes.create(tenant, {
    type: 'CASH',
    name: 'Ruta',
    assignedTo: collector,
    zoneId: zone,
  });
  await db`INSERT INTO cash_transaction (tenant_id, cash_box_id, zone_id, direction, kind, amount_minor, currency, reason)
    VALUES (${tenant}, ${office.id}, ${zone}, 'IN', 'ADJUSTMENT', 1000000, ${CURRENCY}, 'fondeo')`;
  const creditId = randomUUID();
  await tenantStorage.run({ tenantId: tenant }, async () =>
    credits.save(
      {
        id: creditId,
        tenantId: tenant,
        borrowerId: await seedBorrower(tenant),
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
  return { tenant, collector, creditId };
}

const register = (
  f: Fixture,
  extra: Partial<Parameters<CashPaymentDrizzleRepository['register']>[0]>,
) =>
  cashPayments.register({
    tenantId: f.tenant,
    creditId: f.creditId,
    amountMinor: AMOUNT,
    idempotencyKey: null,
    receivedBy: f.collector,
    ...extra,
  });

async function paymentRow(id: string) {
  const [row] = await owner()<{ paid_at: Date; ledger_at: Date }[]>`
    SELECT p.paid_at, t.created_at AS ledger_at
    FROM payment p JOIN cash_transaction t ON t.payment_id = p.id
    WHERE p.id = ${id}`;
  return row;
}

async function auditActions(f: Fixture): Promise<string[]> {
  const rows = await owner()<{ action: string }[]>`
    SELECT action FROM audit_log WHERE tenant_id = ${f.tenant} AND entity = 'payment' ORDER BY created_at`;
  return rows.map((r) => r.action);
}

describeDb('Pagos con fecha atrasada (integración)', () => {
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

  it('captura offline de ayer: el pago queda con su hora real; el libro, con la del registro', async () => {
    const f = await setup();
    const capturedAt = new Date(Date.now() - DAY_MS);
    const before = Date.now();

    const result = await register(f, {
      actorRole: 'COLLECTOR',
      requestedDate: { kind: 'OFFLINE_CAPTURE', capturedAt },
    });

    const row = await paymentRow(result!.id);
    expect(row.paid_at.toISOString()).toBe(capturedAt.toISOString());
    expect(row.ledger_at.getTime()).toBeGreaterThanOrEqual(before - HOUR_MS);
    expect(await auditActions(f)).toEqual(['BACKDATE payment']);
  });

  it('captura offline más antigua que el límite: NO se pierde, se registra hoy y se audita el ajuste', async () => {
    const f = await setup();
    const result = await register(f, {
      actorRole: 'COLLECTOR',
      requestedDate: {
        kind: 'OFFLINE_CAPTURE',
        capturedAt: new Date(Date.now() - (MAX_DAYS_BACK + 2) * DAY_MS),
      },
    });

    const row = await paymentRow(result!.id);
    expect(Date.now() - row.paid_at.getTime()).toBeLessThan(HOUR_MS);
    expect(await auditActions(f)).toEqual(['ADJUST payment-date']);
  });

  it('fecha a mano con el bloqueo: el coordinador no puede (sin efectos); el ADMIN sí', async () => {
    const f = await setup();
    const yesterday = businessDateOf(new Date(Date.now() - DAY_MS), TIME_ZONE);

    await expect(
      register(f, {
        actorRole: 'COORDINATOR',
        requestedDate: { kind: 'MANUAL', paidOn: yesterday },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [{ n }] = await owner()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM payment WHERE tenant_id = ${f.tenant}`;
    expect(n).toBe(0);

    const result = await register(f, {
      actorRole: 'ADMIN',
      requestedDate: { kind: 'MANUAL', paidOn: yesterday },
    });
    const row = await paymentRow(result!.id);
    expect(businessDateOf(row.paid_at, TIME_ZONE)).toBe(yesterday);
  });

  it('una fecha a mano más antigua que el límite se rechaza (409) sin registrar nada', async () => {
    const f = await setup();
    const tooOld = businessDateOf(
      new Date(Date.now() - (MAX_DAYS_BACK + 1) * DAY_MS),
      TIME_ZONE,
    );
    await expect(
      register(f, {
        actorRole: 'ADMIN',
        requestedDate: { kind: 'MANUAL', paidOn: tooOld },
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_DATE_TOO_OLD' });
    expect(await auditActions(f)).toEqual([]);
  });

  it('sin fecha pedida, el pago es de ahora y no genera auditoría de fecha', async () => {
    const f = await setup();
    const result = await register(f, {});
    const row = await paymentRow(result!.id);
    expect(Date.now() - row.paid_at.getTime()).toBeLessThan(HOUR_MS);
    expect(await auditActions(f)).toEqual([]);
  });
});
