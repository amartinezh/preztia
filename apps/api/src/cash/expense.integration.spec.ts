import { randomUUID } from 'node:crypto';
import {
  RequestExpenseHandler,
  ReviewExpenseHandler,
  type ExpenseReceiptStorage,
} from '@preztiaos/application';
import { ConflictError, DomainError, NotFoundError } from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { ExpenseDrizzleRepository } from './expense.repository';
import { CashQueryRepository } from './cash-query.repository';
import { eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Integración de la Fase 3 (solicitudes de gasto v2) contra Postgres real con RLS: zona del gasto,
// alcance de la lista, motivo de rechazo, caja pagadora permitida y asiento EXPENSE atribuido. El
// comprobante se guarda con un almacenamiento falso (MinIO no corre en las pruebas de integración).
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const expenses = new ExpenseDrizzleRepository();
const queries = new CashQueryRepository();
const fakeReceipts: ExpenseReceiptStorage = {
  store: ({ tenantId, expenseId, mimeType }) =>
    Promise.resolve({
      storageKey: `expenses/${tenantId}/${expenseId}`,
      mimeType,
      sha256: 'test',
    }),
};
const request = new RequestExpenseHandler(expenses, fakeReceipts);
const review = new ReviewExpenseHandler(expenses);

const CURRENCY = 'COP';
const JPEG = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff]),
  mimeType: 'image/jpeg',
};

interface Fixture {
  tenant: string;
  collector: string;
  otherCollector: string;
  zoneNorte: string;
  route: string;
  otherRoute: string;
  office: string;
}

async function seed(): Promise<Fixture> {
  const db = owner();
  const f = {
    tenant: randomUUID(),
    collector: randomUUID(),
    otherCollector: randomUUID(),
    zoneNorte: randomUUID(),
    zoneSur: randomUUID(),
  };
  await db`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name) VALUES
    (${f.zoneNorte}, ${f.tenant}, NULL, 'norte', 'Norte'),
    (${f.zoneSur}, ${f.tenant}, NULL, 'sur', 'Sur')`;
  await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths) VALUES
    (${f.collector}, ${f.tenant}, ${`c1-${f.collector}@t.test`}, 'x', 'COLLECTOR', ${['norte']}),
    (${f.otherCollector}, ${f.tenant}, ${`c2-${f.otherCollector}@t.test`}, 'x', 'COLLECTOR', ${['norte']})`;
  const route = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Ruta c1',
    assignedTo: f.collector,
    zoneId: f.zoneNorte,
  });
  const otherRoute = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Ruta c2',
    assignedTo: f.otherCollector,
    zoneId: f.zoneNorte,
  });
  const office = await boxes.create(f.tenant, {
    type: 'CASH',
    name: 'Oficina Norte',
    zoneId: f.zoneNorte,
  });
  for (const id of [route.id, otherRoute.id, office.id]) {
    await db`
      INSERT INTO cash_transaction (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
      VALUES (${f.tenant}, ${id}, 'IN', 'ADJUSTMENT', 100000, ${CURRENCY}, 'saldo inicial de prueba')`;
  }
  return {
    tenant: f.tenant,
    collector: f.collector,
    otherCollector: f.otherCollector,
    zoneNorte: f.zoneNorte,
    route: route.id,
    otherRoute: otherRoute.id,
    office: office.id,
  };
}

const ask = (f: Fixture, amountMinor = 15_000) =>
  request.execute({
    tenantId: f.tenant,
    requestedBy: f.collector,
    description: 'Gasolina',
    amountMinor,
    receipt: JPEG,
  });

const decide = (
  f: Fixture,
  expenseId: string,
  extra: {
    approve: boolean;
    paidFromCashBoxId?: string;
    rejectionReason?: string;
  },
  reviewerZonePaths: readonly string[] | null = null,
) =>
  review.execute({
    tenantId: f.tenant,
    expenseId,
    reviewerId: randomUUID(),
    reviewerZonePaths,
    ...extra,
  });

const list = (f: Fixture, access: SQL | undefined) =>
  queries.listExpenses({ tenantId: f.tenant, page: 1, pageSize: 20, access });

describeDb('Fase 3 — solicitudes de gasto (integración)', () => {
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
      await db`DELETE FROM app_user WHERE tenant_id = ${f.tenant}`;
      await db`DELETE FROM zone WHERE tenant_id = ${f.tenant}`;
    }
    await closeOwner();
  });

  it('la solicitud toma la zona de la caja de ruta y guarda la referencia al comprobante', async () => {
    const f = await setup();
    const { id } = await ask(f);
    const [row] = await owner()`
      SELECT zone_id, status, receipt_storage_key, receipt_mime_type FROM expense WHERE id = ${id}`;
    expect(row).toMatchObject({
      zone_id: f.zoneNorte,
      status: 'PENDING',
      receipt_storage_key: `expenses/${f.tenant}/${id}`,
      receipt_mime_type: 'image/jpeg',
    });
  });

  it('sin comprobante no se crea nada', async () => {
    const f = await setup();
    await expect(
      request.execute({
        tenantId: f.tenant,
        requestedBy: f.collector,
        description: 'Sin foto',
        amountMinor: 1_000,
        receipt: { bytes: new Uint8Array(), mimeType: '' },
      }),
    ).rejects.toThrow(DomainError);
    const [{ n }] =
      await owner()`SELECT count(*)::int AS n FROM expense WHERE tenant_id = ${f.tenant}`;
    expect(n).toBe(0);
  });

  it('rechazar exige motivo y lo deja en el historial', async () => {
    const f = await setup();
    const { id } = await ask(f);
    await expect(decide(f, id, { approve: false })).rejects.toThrow(
      DomainError,
    );
    const rejected = await decide(f, id, {
      approve: false,
      rejectionReason: 'Sin soporte válido',
    });
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Sin soporte válido',
    });
  });

  it('aprobado desde la caja de ruta de quien lo pidió: EXPENSE con su zona y su nombre', async () => {
    const f = await setup();
    const { id } = await ask(f);
    await decide(f, id, { approve: true, paidFromCashBoxId: f.route });
    const [tx] = await owner()`
      SELECT cash_box_id, kind, zone_id, collector_id, amount_minor FROM cash_transaction
      WHERE expense_id = ${id}`;
    expect(tx).toMatchObject({
      cash_box_id: f.route,
      kind: 'EXPENSE',
      zone_id: f.zoneNorte,
      collector_id: f.collector,
    });
    expect(Number(tx.amount_minor)).toBe(15_000);
  });

  it('pagado desde la oficina: el asiento se atribuye igual a quien lo pidió', async () => {
    const f = await setup();
    const { id } = await ask(f);
    await decide(f, id, { approve: true, paidFromCashBoxId: f.office });
    const [tx] =
      await owner()`SELECT collector_id FROM cash_transaction WHERE expense_id = ${id}`;
    expect(tx.collector_id).toBe(f.collector);
  });

  it('no se paga desde la caja de ruta de otro cobrador (y nada queda aprobado)', async () => {
    const f = await setup();
    const { id } = await ask(f);
    const attempt = decide(f, id, {
      approve: true,
      paidFromCashBoxId: f.otherRoute,
    });
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({
      code: 'EXPENSE_BOX_NOT_ALLOWED',
    });
    const [row] = await owner()`SELECT status FROM expense WHERE id = ${id}`;
    expect(row.status).toBe('PENDING');
  });

  it('alcance: el cobrador solo ve lo suyo y un coordinador de otra zona no ve ni revisa', async () => {
    const f = await setup();
    const { id } = await ask(f);

    const own = await list(f, eq(schema.expense.requestedBy, f.collector));
    expect(own.items.map((e) => e.id)).toEqual([id]);
    const others = await list(
      f,
      eq(schema.expense.requestedBy, f.otherCollector),
    );
    expect(others.total).toBe(0);

    const southCoordinator = await list(f, sql`"zone"."path" <@ 'sur'::ltree`);
    expect(southCoordinator.total).toBe(0);
    await expect(
      decide(f, id, { approve: false, rejectionReason: 'No es mío' }, ['sur']),
    ).rejects.toBeInstanceOf(NotFoundError);

    const northCoordinator = await list(
      f,
      sql`"zone"."path" <@ 'norte'::ltree`,
    );
    expect(northCoordinator.items[0]).toMatchObject({
      id,
      zoneName: 'Norte',
      hasReceipt: true,
      requesterRouteBox: { id: f.route, balanceMinor: 100000 },
    });
  });
});
