import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { DomainError } from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from '../cash/cash-box.repository';
import { CreditDrizzleRepository } from '../credit/credit.repository';
import { tenantStorage } from '../tenancy/tenant-context';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { CollectionRouteDrizzleRepository } from './collection-route.repository';
import { CollectionRouteQueryRepository } from './collection-route-query.repository';
import { OsrmRouteOptimizer } from './osrm-route-optimizer';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Integración de la Fase 5 (órdenes de ruta) contra Postgres real con RLS: propuesta con la regla
// "necesita visita", reparto y despacho, vista mínima que se cierra, liquidación atómica con cobro
// y visita, no encontrado sin visita, alcance y aislamiento. Los clientes de prueba no tienen
// coordenadas (salvo uno), así la propuesta no llama a OSRM (sin red en las pruebas).
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const credits = new CreditDrizzleRepository();
const routes = new CollectionRouteDrizzleRepository();
const queries = new CollectionRouteQueryRepository(new OsrmRouteOptimizer());

const CURRENCY = 'COP';
const INSTALLMENT = 20_000;
// Cuotas vencidas hace meses: todas en mora (umbral por defecto: 3).
const PAST_DUE = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];

interface Fixture {
  tenant: string;
  zone: string;
  ana: string;
  beto: string;
  noBox: string;
  anaRoute: string;
  creditA: string;
  creditB: string;
  creditC: string;
}

async function seedCredit(
  tenant: string,
  zone: string,
  office: string,
  admin: string,
  dueDates: string[],
  withGeo: boolean,
) {
  const borrowerId = randomUUID();
  await owner()`INSERT INTO borrower (id, tenant_id, national_id, first_name, last_name, address, phone, lat, lng)
    VALUES (${borrowerId}, ${tenant}, ${borrowerId.slice(0, 8)}, 'Cliente', ${borrowerId.slice(0, 4)},
            'Calle 10 # 20-30', '573001112233', ${withGeo ? 6.25 : null}, ${withGeo ? -75.56 : null})`;
  const id = randomUUID();
  await tenantStorage.run({ tenantId: tenant }, () =>
    credits.save(
      {
        id,
        tenantId: tenant,
        borrowerId,
        zoneId: zone,
        principalMinor: INSTALLMENT * dueDates.length,
        interestPct: 0,
        installmentsCount: dueDates.length,
        frequency: 'DAILY',
        currency: CURRENCY,
        startDate: '2026-01-04',
        endDate: dueDates[dueDates.length - 1],
      },
      dueDates.map((dueDate, i) => ({
        seq: i + 1,
        amountDueMinor: INSTALLMENT,
        dueDate,
      })),
      { cashBoxId: office, grantedBy: admin },
    ),
  );
  return id;
}

async function seed(): Promise<Fixture> {
  const db = owner();
  const tenant = randomUUID();
  const zone = randomUUID();
  const [ana, beto, noBox, admin] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  await db`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name) VALUES (${zone}, ${tenant}, NULL, 'norte', 'Norte')`;
  for (const [id, label] of [
    [ana, 'ana'],
    [beto, 'beto'],
    [noBox, 'nobox'],
  ] as const) {
    await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths)
      VALUES (${id}, ${tenant}, ${`${label}-${id}@t.test`}, 'x', 'COLLECTOR', ${['norte']})`;
  }
  const office = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Oficina',
    zoneId: zone,
  });
  await db`INSERT INTO cash_transaction (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
    VALUES (${tenant}, ${office.id}, 'IN', 'ADJUSTMENT', 10000000, ${CURRENCY}, 'saldo inicial de prueba')`;
  const anaRoute = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Ruta Ana',
    assignedTo: ana,
    zoneId: zone,
  });
  await boxes.create(tenant, {
    type: 'CASH',
    name: 'Ruta Beto',
    assignedTo: beto,
    zoneId: zone,
  });
  return {
    tenant,
    zone,
    ana,
    beto,
    noBox,
    anaRoute: anaRoute.id,
    creditA: await seedCredit(tenant, zone, office.id, admin, PAST_DUE, true),
    creditB: await seedCredit(tenant, zone, office.id, admin, PAST_DUE, false),
    // Solo 2 cuotas vencidas: bajo el umbral, no necesita visita.
    creditC: await seedCredit(
      tenant,
      zone,
      office.id,
      admin,
      PAST_DUE.slice(0, 2),
      false,
    ),
  };
}

const dispatch = (
  f: Fixture,
  stops: { creditId: string; collectorId: string }[],
  zoneScope?: ReturnType<typeof sql>,
) =>
  routes.dispatch({
    tenantId: f.tenant,
    createdBy: randomUUID(),
    zoneScope,
    currency: CURRENCY,
    body: { zoneId: f.zone, stops },
  });

const openStopsOf = async (f: Fixture, collectorId: string) =>
  (
    await queries.myStops({
      tenantId: f.tenant,
      collectorId,
      status: 'open',
      page: 1,
      pageSize: 50,
    })
  ).items;

describeDb('Fase 5 — órdenes de ruta (integración)', () => {
  const fixtures: Fixture[] = [];
  async function setup(): Promise<Fixture> {
    const f = await seed();
    fixtures.push(f);
    return f;
  }

  afterAll(async () => {
    const db = owner();
    for (const f of fixtures) {
      await db`DELETE FROM collection_note WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM collection_visit WHERE tenant_id = ${f.tenant}`;
      await cleanupTenant(f.tenant);
      await db`DELETE FROM audit_log WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM borrower WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM app_user WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM zone WHERE tenant_id = ${f.tenant}`;
    }
    await closeOwner();
  });

  it('propone solo a quienes necesitan visita, con el monto vencido', async () => {
    const f = await setup();
    const { items } = await queries.proposal({
      tenantId: f.tenant,
      zoneId: f.zone,
      zoneScope: undefined,
    });
    expect(items.map((i) => i.creditId).sort()).toEqual(
      [f.creditA, f.creditB].sort(),
    );
    expect(items[0]).toMatchObject({
      amountToCollectMinor: INSTALLMENT * PAST_DUE.length,
      alreadyDispatched: false,
    });
  });

  it('reparte entre cobradores; no despacha dos veces al mismo cliente ni a quien no tiene caja', async () => {
    const f = await setup();
    await dispatch(f, [
      { creditId: f.creditA, collectorId: f.ana },
      { creditId: f.creditB, collectorId: f.beto },
    ]);
    expect((await openStopsOf(f, f.ana)).map((s) => s.clientName)).toHaveLength(
      1,
    );
    expect(await openStopsOf(f, f.beto)).toHaveLength(1);
    await expect(
      dispatch(f, [{ creditId: f.creditA, collectorId: f.beto }]),
    ).rejects.toMatchObject({
      code: 'STOP_ALREADY_OPEN',
    });
    await expect(
      dispatch(f, [{ creditId: f.creditC, collectorId: f.noBox }]),
    ).rejects.toMatchObject({
      code: 'NO_ROUTE_CASH_BOX',
    });
    const { items } = await queries.proposal({
      tenantId: f.tenant,
      zoneId: f.zone,
      zoneScope: undefined,
    });
    expect(items.every((i) => i.alreadyDispatched)).toBe(true);
  });

  it('pagó: abono en efectivo a la caja de ruta de quien cobró, visita y cierre de la vista mínima', async () => {
    const f = await setup();
    await dispatch(f, [{ creditId: f.creditA, collectorId: f.ana }]);
    const [stop] = await openStopsOf(f, f.ana);
    expect(stop).toMatchObject({
      address: 'Calle 10 # 20-30',
      phone: '573001112233',
    });

    await routes.resolve({
      tenantId: f.tenant,
      collectorId: f.ana,
      stopId: stop.id,
      body: { outcome: 'PAID', collectedMinor: 30_000 },
    });

    const [tx] = await owner()`
      SELECT t.cash_box_id, t.kind, t.collector_id FROM cash_transaction t
      JOIN route_stop s ON s.payment_id = t.payment_id WHERE s.id = ${stop.id}`;
    expect(tx).toMatchObject({
      cash_box_id: f.anaRoute,
      kind: 'PAYMENT_IN',
      collector_id: f.ana,
    });
    const [{ n }] =
      await owner()`SELECT count(*)::int AS n FROM collection_visit WHERE credit_id = ${f.creditA}`;
    expect(n).toBe(1);

    expect(await openStopsOf(f, f.ana)).toHaveLength(0);
    const done = await queries.myStops({
      tenantId: f.tenant,
      collectorId: f.ana,
      status: 'done',
      page: 1,
      pageSize: 10,
    });
    expect(done.items[0]).toMatchObject({
      outcome: 'PAID',
      collectedMinor: 30_000,
      address: null,
      phone: null,
      lat: null,
    });
  });

  it('valida el resultado: pagó sin monto, no pagó sin motivo, promesa vencida', async () => {
    const f = await setup();
    await dispatch(f, [{ creditId: f.creditA, collectorId: f.ana }]);
    const [stop] = await openStopsOf(f, f.ana);
    const resolve = (body: Parameters<typeof routes.resolve>[0]['body']) =>
      routes.resolve({
        tenantId: f.tenant,
        collectorId: f.ana,
        stopId: stop.id,
        body,
      });
    await expect(resolve({ outcome: 'PAID' })).rejects.toThrow(DomainError);
    await expect(resolve({ outcome: 'NOT_PAID' })).rejects.toThrow(DomainError);
    await expect(
      resolve({ outcome: 'PROMISE', promiseDate: '2020-01-01' }),
    ).rejects.toThrow(DomainError);
    expect(await openStopsOf(f, f.ana)).toHaveLength(1);
  });

  it('no encontrado: queda la observación pero el cliente sigue pendiente de visita', async () => {
    const f = await setup();
    await dispatch(f, [{ creditId: f.creditB, collectorId: f.beto }]);
    const [stop] = await openStopsOf(f, f.beto);
    await routes.resolve({
      tenantId: f.tenant,
      collectorId: f.beto,
      stopId: stop.id,
      body: { outcome: 'NOT_FOUND' },
    });
    const [{ notes }] =
      await owner()`SELECT count(*)::int AS notes FROM collection_note WHERE credit_id = ${f.creditB}`;
    const [{ visits }] =
      await owner()`SELECT count(*)::int AS visits FROM collection_visit WHERE credit_id = ${f.creditB}`;
    expect([Number(notes), Number(visits)]).toEqual([1, 0]);
    const { items } = await queries.proposal({
      tenantId: f.tenant,
      zoneId: f.zone,
      zoneScope: undefined,
    });
    expect(items.find((i) => i.creditId === f.creditB)).toMatchObject({
      alreadyDispatched: false,
    });
  });

  it('un cobrador no liquida ni ve la parada de otro; un coordinador de otra zona no propone', async () => {
    const f = await setup();
    await dispatch(f, [{ creditId: f.creditA, collectorId: f.ana }]);
    const [stop] = await openStopsOf(f, f.ana);
    await expect(
      routes.resolve({
        tenantId: f.tenant,
        collectorId: f.beto,
        stopId: stop.id,
        body: { outcome: 'NOT_FOUND' },
      }),
    ).rejects.toThrow('Parada no encontrada');
    await expect(
      queries.proposal({
        tenantId: f.tenant,
        zoneId: f.zone,
        zoneScope: sql`"zone"."path" <@ 'sur'::ltree`,
      }),
    ).rejects.toThrow('Zona no encontrada');
  });

  it('RLS: otro tenant no ve las paradas y la app no las borra', async () => {
    const f = await setup();
    const other = await setup();
    await dispatch(f, [{ creditId: f.creditA, collectorId: f.ana }]);
    const [stop] = await openStopsOf(f, f.ana);
    const seen = await withTenantTxFor(other.tenant, (tx) =>
      tx
        .select({ id: schema.routeStop.id })
        .from(schema.routeStop)
        .where(eq(schema.routeStop.id, stop.id)),
    );
    expect(seen).toHaveLength(0);
    await expect(
      withTenantTxFor(f.tenant, (tx) =>
        tx.delete(schema.routeStop).where(eq(schema.routeStop.id, stop.id)),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
