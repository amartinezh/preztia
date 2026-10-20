import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  businessDateOf,
} from '@preztiaos/domain';
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
  officeId: string;
  routeId: string;
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
    blockBackdatedPayments: true,
    backdateMaxDays: MAX_DAYS_BACK,
  };
  await db`INSERT INTO tenant_config (tenant_id, operational_settings) VALUES (${tenant}, ${db.json(settings)})`;
  const office = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Oficina',
    zoneId: zone,
  });
  const route = await boxes.create(tenant, {
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
  return {
    tenant,
    collector,
    creditId,
    officeId: office.id,
    routeId: route.id,
  };
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

    // El ADMIN no tiene caja de ruta: registra el pago recibido en la oficina, en la caja que elige.
    const result = await register(f, {
      actorRole: 'ADMIN',
      requestedDate: { kind: 'MANUAL', paidOn: yesterday },
      receivingCashBoxId: f.officeId,
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
        receivingCashBoxId: f.officeId,
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

  // ── Caja que recibe el abono y crédito saldado ─────────────────────────────

  async function ledgerOf(paymentId: string) {
    const [row] = await owner()<
      {
        cash_box_id: string;
        collector_id: string | null;
        amount_minor: string;
      }[]
    >`SELECT cash_box_id, collector_id, amount_minor FROM cash_transaction WHERE payment_id = ${paymentId}`;
    return row;
  }

  async function creditStatus(f: Fixture): Promise<string> {
    const [row] = await owner()<{ status: string }[]>`
      SELECT status FROM credit WHERE id = ${f.creditId}`;
    return row.status;
  }

  async function paymentCount(f: Fixture): Promise<number> {
    const [{ n }] = await owner()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM payment WHERE tenant_id = ${f.tenant}`;
    return n;
  }

  it('el ADMIN registra un pago en la oficina: entra a la caja elegida, sin atribuirlo a un cobrador', async () => {
    const f = await setup();
    const result = await register(f, {
      actorRole: 'ADMIN',
      receivingCashBoxId: f.officeId,
    });
    const ledger = await ledgerOf(result!.id);
    expect(ledger.cash_box_id).toBe(f.officeId);
    expect(ledger.collector_id).toBeNull();
    expect(Number(ledger.amount_minor)).toBe(AMOUNT);
  });

  it('quien no es cobrador debe decir qué caja recibe el dinero (sin efectos)', async () => {
    const f = await setup();
    await expect(
      register(f, { actorRole: 'COORDINATOR' }),
    ).rejects.toMatchObject({
      code: 'RECEIVING_BOX_REQUIRED',
    });
    await expect(register(f, { actorRole: 'ADMIN' })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(await paymentCount(f)).toBe(0);
  });

  it('la oficina no puede meter el pago en la caja de ruta de un cobrador (409, sin efectos)', async () => {
    const f = await setup();
    await expect(
      register(f, { actorRole: 'ADMIN', receivingCashBoxId: f.routeId }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await paymentCount(f)).toBe(0);
  });

  it('el cobrador recibe en su caja de ruta y no puede elegir otra (403)', async () => {
    const f = await setup();
    await expect(
      register(f, { actorRole: 'COLLECTOR', receivingCashBoxId: f.officeId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const result = await register(f, { actorRole: 'COLLECTOR' });
    expect((await ledgerOf(result!.id)).cash_box_id).toBe(f.routeId);
  });

  it('el abono que salda la cartera deja el crédito SETTLED y lo deja en la bitácora', async () => {
    const f = await setup();
    await register(f, { actorRole: 'COLLECTOR', amountMinor: 60_000 });
    expect(await creditStatus(f)).toBe('ACTIVE');

    const last = await register(f, {
      actorRole: 'COLLECTOR',
      amountMinor: 60_000,
    });

    expect(last!.balanceMinor).toBe(0);
    expect(await creditStatus(f)).toBe('SETTLED');
    const events = await owner()<{ type: string }[]>`
      SELECT type FROM payment_event WHERE payment_id = ${last!.id} ORDER BY created_at`;
    expect(events.map((e) => e.type)).toContain('credit_settled');
  });
});
