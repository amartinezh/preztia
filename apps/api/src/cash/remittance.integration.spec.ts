import { randomUUID } from 'node:crypto';
import { eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { RemittanceDrizzleRepository } from './remittance.repository';
import { RemittanceQueryRepository } from './remittance-query.repository';
import { CashPaymentDrizzleRepository } from '../payments/cash-payment.repository';
import { CreditDrizzleRepository } from '../credit/credit.repository';
import { tenantStorage } from '../tenancy/tenant-context';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Integración de la Fase 2 (rendición diaria y deuda del cobrador) contra Postgres real con RLS:
// declarar → contar/recibir → el faltante queda como deuda; cobros posteriores al corte; cierre de
// deuda; alcance por zona. Ver docs/PLAN_CONTROL_CAMPO_Y_LIQUIDACION.md (Fase 2).
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const remittances = new RemittanceDrizzleRepository();
const queries = new RemittanceQueryRepository();
const cashPayments = new CashPaymentDrizzleRepository();
const credits = new CreditDrizzleRepository();

const CURRENCY = 'COP';
const PRINCIPAL = 100_000;
const INSTALLMENT = 60_000; // 2 cuotas: total 120.000 (20%)

interface Fixture {
  tenant: string;
  zone: string;
  otherZone: string;
  collector: string;
  admin: string;
  office: string;
  route: string;
  creditId: string;
}

async function seed(): Promise<Fixture> {
  const db = owner();
  const f = {
    tenant: randomUUID(),
    zone: randomUUID(),
    otherZone: randomUUID(),
    collector: randomUUID(),
    admin: randomUUID(),
  };
  await db`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name) VALUES
    (${f.zone}, ${f.tenant}, NULL, 'norte', 'Norte'),
    (${f.otherZone}, ${f.tenant}, NULL, 'sur', 'Sur')`;
  await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths) VALUES
    (${f.collector}, ${f.tenant}, ${`cob-${f.collector}@t.test`}, 'x', 'COLLECTOR', ${['norte']}),
    (${f.admin}, ${f.tenant}, ${`adm-${f.admin}@t.test`}, 'x', 'ADMIN', ${[]})`;
  const office = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Oficina Norte',
    zoneId: f.zone,
  });
  await db`
    INSERT INTO cash_transaction (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
    VALUES (${f.tenant}, ${office.id}, 'IN', 'ADJUSTMENT', 1000000, ${CURRENCY}, 'saldo inicial de prueba')`;
  const route = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Ruta',
    assignedTo: f.collector,
    zoneId: f.zone,
  });
  const creditId = randomUUID();
  await tenantStorage.run({ tenantId: f.tenant }, () =>
    credits.save(
      {
        id: creditId,
        tenantId: f.tenant,
        borrowerId: randomUUID(),
        zoneId: f.zone,
        principalMinor: PRINCIPAL,
        interestPct: 200,
        installmentsCount: 2,
        frequency: 'DAILY',
        currency: CURRENCY,
        startDate: '2026-09-25',
        endDate: '2026-09-27',
      },
      [
        { seq: 1, amountDueMinor: INSTALLMENT, dueDate: '2026-09-26' },
        { seq: 2, amountDueMinor: INSTALLMENT, dueDate: '2026-09-27' },
      ],
      { cashBoxId: office.id, grantedBy: f.admin },
    ),
  );
  return { ...f, office: office.id, route: route.id, creditId };
}

const collect = (f: Fixture, amountMinor: number) =>
  cashPayments.register({
    tenantId: f.tenant,
    creditId: f.creditId,
    amountMinor,
    idempotencyKey: null,
    receivedBy: f.collector,
  });

const mine = (f: Fixture, now = new Date()) =>
  queries.mine({
    tenantId: f.tenant,
    collectorId: f.collector,
    currency: CURRENCY,
    now,
  });

const submit = (f: Fixture, declaredMinor: number) =>
  remittances.submit({
    tenantId: f.tenant,
    collectorId: f.collector,
    currency: CURRENCY,
    body: { declaredMinor },
    now: new Date(),
  });

const receive = (
  f: Fixture,
  id: string,
  countedMinor: number,
  zoneScope?: SQL,
) =>
  remittances.receive({
    tenantId: f.tenant,
    remittanceId: id,
    receivedBy: f.admin,
    zoneScope,
    body: { countedMinor, destinationCashBoxId: f.office },
  });

async function balance(boxId: string): Promise<number> {
  const [row] = await owner()`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END), 0)::bigint AS b
    FROM cash_transaction WHERE cash_box_id = ${boxId}`;
  return Number(row.b);
}

describeDb('Fase 2 — rendición del cobrador (integración)', () => {
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

  it('sin cobros en efectivo está al día (exento de rendir)', async () => {
    const f = await setup();
    const view = await mine(f);
    expect(view).toMatchObject({
      hasRouteBox: true,
      status: 'UP_TO_DATE',
      cashInHandMinor: 0,
    });
  });

  it('declara, el coordinador recibe con faltante y el faltante queda como deuda arrastrada', async () => {
    const f = await setup();
    await collect(f, 50_000);
    await collect(f, 10_000);
    const before = await mine(f);
    expect(before.summary).toMatchObject({
      collectedMinor: 60_000,
      expectedMinor: 60_000,
    });
    expect(['PENDING', 'LATE']).toContain(before.status);

    const declared = await submit(f, 60_000);
    expect((await mine(f)).status).toBe('AWAITING_RECEPTION');

    const received = await receive(f, declared.id, 55_000);
    expect(received).toMatchObject({
      status: 'RECEIVED',
      expectedAtReceptionMinor: 60_000,
      countedMinor: 55_000,
      shortfallMinor: 5_000,
      closingBalanceMinor: 5_000,
    });
    expect(await balance(f.route)).toBe(5_000);
    expect(await balance(f.office)).toBe(1_000_000 - PRINCIPAL + 55_000);

    const after = await mine(f);
    expect(after).toMatchObject({
      status: 'UP_TO_DATE',
      carriedDebtMinor: 5_000,
      cashInHandMinor: 5_000,
    });
    // El corte cubre la entrega: el resumen del nuevo período arranca en la deuda, sin movimientos.
    expect(after.summary).toMatchObject({
      openingMinor: 5_000,
      collectedMinor: 0,
      transferredOutMinor: 0,
    });
  });

  it('un cobro después del corte abre una nueva obligación y suma a la deuda previa', async () => {
    const f = await setup();
    await collect(f, 20_000);
    const first = await submit(f, 20_000);
    await receive(f, first.id, 15_000);

    await collect(f, 30_000);
    const view = await mine(f);
    expect(view.summary).toMatchObject({
      openingMinor: 5_000,
      collectedMinor: 30_000,
      expectedMinor: 35_000,
    });
    // Mañana a esta hora ya pasó la hora límite de hoy: atrasado.
    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
    expect((await mine(f, tomorrow)).status).toBe('LATE');
  });

  it('no se recibe más de lo esperado', async () => {
    const f = await setup();
    await collect(f, 10_000);
    const declared = await submit(f, 10_000);
    await expect(receive(f, declared.id, 10_001)).rejects.toMatchObject({
      code: 'COUNT_EXCEEDS_EXPECTED',
    });
  });

  it('una segunda declaración abierta se rechaza', async () => {
    const f = await setup();
    await collect(f, 10_000);
    await submit(f, 10_000);
    await expect(submit(f, 10_000)).rejects.toMatchObject({
      code: 'REMITTANCE_ALREADY_SUBMITTED',
    });
  });

  it('un coordinador fuera de la zona no ve ni recibe la rendición', async () => {
    const f = await setup();
    await collect(f, 10_000);
    const declared = await submit(f, 10_000);
    const outOfScope = sql`"zone"."path" <@ 'sur'::ltree`;
    await expect(receive(f, declared.id, 10_000, outOfScope)).rejects.toThrow(
      'Rendición no encontrada',
    );
  });

  it('el ADMIN cierra la deuda por nómina, sin pasarse de lo arrastrado', async () => {
    const f = await setup();
    await collect(f, 20_000);
    const declared = await submit(f, 20_000);
    await receive(f, declared.id, 12_000);

    const close = (amountMinor: number) =>
      remittances.closeDebt({
        tenantId: f.tenant,
        collectorId: f.collector,
        currency: CURRENCY,
        closedBy: f.admin,
        type: 'PAYROLL',
        amountMinor,
        reason: 'Descuento nómina septiembre',
        now: new Date(),
      });
    await expect(close(8_001)).rejects.toMatchObject({ code: 'DEBT_EXCEEDED' });

    const result = await close(8_000);
    expect(result.carriedDebtMinor).toBe(0);
    expect(await mine(f)).toMatchObject({
      carriedDebtMinor: 0,
      cashInHandMinor: 0,
    });
    const [row] = await owner()`
      SELECT kind, debt_closure_type FROM cash_transaction WHERE id = ${result.transactionId}`;
    expect(row).toMatchObject({
      kind: 'DEBT_CLOSURE',
      debt_closure_type: 'PAYROLL',
    });
  });

  it('RLS: otro tenant no ve ni modifica la rendición, y la app no puede borrarla', async () => {
    const f = await setup();
    const other = await setup();
    await collect(f, 10_000);
    const declared = await submit(f, 10_000);

    const seenByOther = await withTenantTxFor(other.tenant, (tx) =>
      tx
        .select({ id: schema.collectorRemittance.id })
        .from(schema.collectorRemittance)
        .where(eq(schema.collectorRemittance.id, declared.id)),
    );
    expect(seenByOther).toHaveLength(0);

    const updatedByOther = await withTenantTxFor(other.tenant, (tx) =>
      tx
        .update(schema.collectorRemittance)
        .set({ declaredMinor: 1 })
        .where(eq(schema.collectorRemittance.id, declared.id))
        .returning({ id: schema.collectorRemittance.id }),
    );
    expect(updatedByOther).toHaveLength(0);

    const history = await queries.history({
      tenantId: other.tenant,
      zoneScope: undefined,
      page: 1,
      pageSize: 20,
    });
    expect(history.total).toBe(0);

    // Evidencia de dinero entregado: ni el propio tenant la borra desde la app.
    await expect(
      withTenantTxFor(f.tenant, (tx) =>
        tx
          .delete(schema.collectorRemittance)
          .where(eq(schema.collectorRemittance.id, declared.id)),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('el tablero muestra al cobrador con su deuda (reporte para nómina)', async () => {
    const f = await setup();
    await collect(f, 20_000);
    const declared = await submit(f, 20_000);
    await receive(f, declared.id, 19_000);

    const board = await queries.board({
      tenantId: f.tenant,
      currency: CURRENCY,
      zoneScope: undefined,
      withDebt: true,
      page: 1,
      pageSize: 20,
      now: new Date(),
    });
    expect(board.total).toBe(1);
    expect(board.items[0]).toMatchObject({
      collectorId: f.collector,
      carriedDebtMinor: 1_000,
      status: 'UP_TO_DATE',
    });
  });
});
