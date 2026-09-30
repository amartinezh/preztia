import { randomUUID } from 'node:crypto';
import {
  PayCollectorCommissionHandler,
  SetZoneCommissionHandler,
  type CommissionActor,
} from '@preztiaos/application';
import {
  ConflictError,
  NotFoundError,
  businessDateOf,
  type SettlementSnapshot,
} from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from '../cash/cash-box.repository';
import { CreditDrizzleRepository } from '../credit/credit.repository';
import { CashPaymentDrizzleRepository } from '../payments/cash-payment.repository';
import { SettlementRepository } from '../settlements/settlement.repository';
import { tenantStorage } from '../tenancy/tenant-context';
import { CommissionSettingsRepository } from './commission-settings.repository';
import { CommissionPaymentRepository } from './commission-payment.repository';
import {
  owner,
  cleanupTenant,
  closeOwner,
  hasDb,
  seedBorrower,
} from '../../test/db-helpers';

// Comisión del cobrador de punta a punta contra Postgres real con RLS: configuración por zona con
// tope, causación sellada en la foto al cerrar, pago como asiento COMMISSION del libro (atribuido
// al cobrador y a su zona, desde una caja permitida) y una sola vez aunque se pida dos veces.
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const credits = new CreditDrizzleRepository();
const cashPayments = new CashPaymentDrizzleRepository();
const settlements = new SettlementRepository();
const settingsRepo = new CommissionSettingsRepository();
const paymentsRepo = new CommissionPaymentRepository();
const setZone = new SetZoneCommissionHandler(settingsRepo);
const payCommission = new PayCollectorCommissionHandler(paymentsRepo);

const CURRENCY = 'COP';
const TIME_ZONE = 'America/Bogota';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const CAP_PER_MILLE = 100; // 10 %
const RATE_PER_MILLE = 50; // 5 %
const COLLECTED = 60_000;
const COMMISSION = 3_000; // 5 % de 60.000
const OFFICE_FUNDS = 1_000_000;

const ADMIN: CommissionActor = { userId: randomUUID(), scopes: null };

interface Fixture {
  tenant: string;
  zone: string;
  collector: string;
  otherCollector: string;
  office: string;
  route: string;
  otherRoute: string;
}

async function seed(commissionsEnabled: boolean): Promise<Fixture> {
  const db = owner();
  const f = {
    tenant: randomUUID(),
    zone: randomUUID(),
    collector: randomUUID(),
    otherCollector: randomUUID(),
  };
  await db`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name) VALUES (${f.zone}, ${f.tenant}, NULL, 'norte', 'Norte')`;
  await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths) VALUES
    (${f.collector}, ${f.tenant}, ${`c1-${f.collector}@t.test`}, 'x', 'COLLECTOR', ${['norte']}),
    (${f.otherCollector}, ${f.tenant}, ${`c2-${f.otherCollector}@t.test`}, 'x', 'COLLECTOR', ${['norte']})`;
  // Tope del ADMIN y "Liquidar desde" antes del cobro (el resto, valores por defecto).
  const settings = {
    commissionsEnabled,
    commissionMaxPctBaseThousand: CAP_PER_MILLE,
    settlementStartDate: businessDateOf(daysAgo(15), TIME_ZONE),
  };
  await db`INSERT INTO tenant_config (tenant_id, operational_settings) VALUES (${f.tenant}, ${db.json(settings)})`;
  const office = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Oficina Norte',
    zoneId: f.zone,
  });
  const route = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Ruta 1',
    assignedTo: f.collector,
    zoneId: f.zone,
  });
  const otherRoute = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Ruta 2',
    assignedTo: f.otherCollector,
    zoneId: f.zone,
  });
  await db`INSERT INTO cash_transaction (tenant_id, cash_box_id, zone_id, direction, kind, amount_minor, currency, reason, created_at)
    VALUES (${f.tenant}, ${office.id}, ${f.zone}, 'IN', 'ADJUSTMENT', ${OFFICE_FUNDS}, ${CURRENCY}, 'fondeo', ${daysAgo(14)})`;

  // Un crédito y un cobro en efectivo de 60.000 del cobrador, fechado en un período ya terminado.
  const creditId = randomUUID();
  await tenantStorage.run({ tenantId: f.tenant }, async () =>
    credits.save(
      {
        id: creditId,
        tenantId: f.tenant,
        borrowerId: await seedBorrower(f.tenant),
        zoneId: f.zone,
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
      { cashBoxId: office.id, grantedBy: ADMIN.userId },
    ),
  );
  await cashPayments.register({
    tenantId: f.tenant,
    creditId,
    amountMinor: COLLECTED,
    idempotencyKey: null,
    receivedBy: f.collector,
  });
  const past = daysAgo(8);
  await db`UPDATE cash_transaction SET created_at = ${past} WHERE tenant_id = ${f.tenant} AND kind <> 'ADJUSTMENT'`;
  await db`UPDATE payment_allocation SET created_at = ${past} WHERE tenant_id = ${f.tenant}`;
  await db`UPDATE credit SET created_at = ${past} WHERE tenant_id = ${f.tenant}`;
  return {
    ...f,
    office: office.id,
    route: route.id,
    otherRoute: otherRoute.id,
  };
}

/** Cierra todos los períodos terminados y devuelve la foto que contiene el cobro. */
async function closeUntilCurrent(
  f: Fixture,
): Promise<{ id: string; snapshot: SettlementSnapshot }> {
  const closed: string[] = [];
  for (;;) {
    try {
      closed.push(
        await settlements.close({
          tenantId: f.tenant,
          currency: CURRENCY,
          closedBy: null,
          now: new Date(),
        }),
      );
    } catch (err) {
      if (err instanceof ConflictError) break;
      throw err;
    }
  }
  for (const id of closed) {
    const view = await settlements.get({
      tenantId: f.tenant,
      id,
      scopes: null,
    });
    const line = view.snapshot.collectors.find(
      (c) => c.collectorId === f.collector,
    );
    if ((line?.collectedMinor ?? 0) > 0)
      return { id, snapshot: view.snapshot as SettlementSnapshot };
  }
  throw new Error('Ningún período cerrado contiene el cobro');
}

const pay = (
  f: Fixture,
  settlementId: string,
  cashBoxId: string,
  actor: CommissionActor = ADMIN,
) =>
  payCommission.execute({
    tenantId: f.tenant,
    settlementId,
    collectorId: f.collector,
    cashBoxId,
    actor,
  });

interface CommissionRow {
  cash_box_id: string;
  collector_id: string;
  zone_id: string;
  amount_minor: string;
  direction: string;
}
const commissionEntries = async (f: Fixture) =>
  (await owner()`SELECT cash_box_id, collector_id, zone_id, amount_minor, direction FROM cash_transaction
    WHERE tenant_id = ${f.tenant} AND kind = 'COMMISSION'`) as unknown as CommissionRow[];

describeDb('Comisión del cobrador (integración)', () => {
  const fixtures: Fixture[] = [];
  async function setup(commissionsEnabled = true): Promise<Fixture> {
    const f = await seed(commissionsEnabled);
    fixtures.push(f);
    await setZone.execute({
      tenantId: f.tenant,
      zoneId: f.zone,
      policy: { ratePerMille: RATE_PER_MILLE, base: 'COLLECTED' },
      actor: ADMIN,
    });
    return f;
  }

  afterAll(async () => {
    const db = owner();
    for (const f of fixtures) {
      await cleanupTenant(f.tenant);
      await db`DELETE FROM settlement_period WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM borrower WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM audit_log WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM app_user WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM zone WHERE tenant_id = ${f.tenant}`;
    }
    await closeOwner();
  });

  it('la configuración de la zona se hereda y el coordinador no supera el tope', async () => {
    const f = await setup();
    const view = await settingsRepo.view({
      tenantId: f.tenant,
      scopes: ['norte'],
    });
    expect(view.capPerMille).toBe(CAP_PER_MILLE);
    expect(view.zones[0]).toMatchObject({
      own: { ratePerMille: RATE_PER_MILLE, base: 'COLLECTED' },
      effective: {
        ratePerMille: RATE_PER_MILLE,
        sourceZoneId: f.zone,
        cappedByLimit: false,
      },
    });
    const coordinator: CommissionActor = {
      userId: randomUUID(),
      scopes: ['norte'],
    };
    await expect(
      setZone.execute({
        tenantId: f.tenant,
        zoneId: f.zone,
        policy: { ratePerMille: CAP_PER_MILLE + 1, base: 'COLLECTED' },
        actor: coordinator,
      }),
    ).rejects.toMatchObject({ code: 'COMMISSION_ABOVE_CAP' });
    const outsider: CommissionActor = { userId: randomUUID(), scopes: ['sur'] };
    await expect(
      setZone.execute({
        tenantId: f.tenant,
        zoneId: f.zone,
        policy: null,
        actor: outsider,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const [audit] = await owner()`SELECT count(*)::int AS n FROM audit_log
      WHERE tenant_id = ${f.tenant} AND action = 'SET zone-commission'`;
    expect(audit.n).toBe(1);
  });

  it('apagadas: la foto no causa comisión (aunque la zona esté configurada) y no hay nada que pagar', async () => {
    const f = await setup(false);
    const { id, snapshot } = await closeUntilCurrent(f);
    const line = snapshot.collectors.find(
      (c) => c.collectorId === f.collector,
    )!;
    expect(line.commission).toBeNull();
    expect(snapshot.result.commissionsMinor).toBe(0);
    await expect(pay(f, id, f.route)).rejects.toMatchObject({
      code: 'NOTHING_TO_PAY',
    });
    expect(await commissionEntries(f)).toHaveLength(0);
    const view = await settingsRepo.view({ tenantId: f.tenant, scopes: null });
    expect(view.enabled).toBe(false);
  });

  it('al cerrar, la foto sella la comisión causada y la resta de la utilidad', async () => {
    const f = await setup();
    const { snapshot } = await closeUntilCurrent(f);
    const line = snapshot.collectors.find(
      (c) => c.collectorId === f.collector,
    )!;
    expect(line.commission).toMatchObject({
      base: 'COLLECTED',
      ratePerMille: RATE_PER_MILLE,
      sourceZoneId: f.zone,
      baseAmountMinor: COLLECTED,
      amountMinor: COMMISSION,
    });
    const zone = snapshot.zones.find((z) => z.zoneId === f.zone)!.result;
    expect(zone.commissionsMinor).toBe(COMMISSION);
    expect(zone.utilityMinor).toBe(
      zone.interestEarnedMinor -
        zone.expensesMinor -
        zone.writeOffMinor -
        COMMISSION,
    );
  });

  it('se paga desde su caja de ruta, atribuido a él y a su zona, y una sola vez', async () => {
    const f = await setup();
    const { id } = await closeUntilCurrent(f);

    // Nunca desde la caja de ruta de otro cobrador.
    await expect(pay(f, id, f.otherRoute)).rejects.toMatchObject({
      code: 'COMMISSION_BOX_NOT_ALLOWED',
    });
    // Un coordinador de otra zona no la ve.
    await expect(
      pay(f, id, f.route, { userId: randomUUID(), scopes: ['sur'] }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(pay(f, id, f.route)).resolves.toMatchObject({
      amountMinor: COMMISSION,
    });
    await expect(pay(f, id, f.office)).rejects.toMatchObject({
      code: 'COMMISSION_ALREADY_PAID',
    });

    const entries = await commissionEntries(f);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      cash_box_id: f.route,
      collector_id: f.collector,
      zone_id: f.zone,
      direction: 'OUT',
    });
    expect(Number(entries[0].amount_minor)).toBe(COMMISSION);

    const view = await settlements.get({
      tenantId: f.tenant,
      id,
      scopes: ['norte'],
    });
    expect(view.commissionPayments).toEqual([
      expect.objectContaining({
        collectorId: f.collector,
        cashBoxId: f.route,
        amountMinor: COMMISSION,
      }),
    ]);
    // El pago cae en el período en curso como egreso de tesorería (COMMISSIONS), no en el cerrado.
    const current = await settlements.current({
      tenantId: f.tenant,
      currency: CURRENCY,
      scopes: null,
      now: new Date(),
    });
    expect(current.snapshot.totals.concepts.COMMISSIONS).toBe(COMMISSION);
  });

  it('dos pagos simultáneos de la misma comisión: solo uno sale del libro', async () => {
    const f = await setup();
    const { id } = await closeUntilCurrent(f);

    const results = await Promise.allSettled([
      pay(f, id, f.route),
      pay(f, id, f.office),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'COMMISSION_ALREADY_PAID' });
    expect(await commissionEntries(f)).toHaveLength(1);
  });
});
