import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { ConflictError, DomainError } from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { BankAccountDrizzleRepository } from './bank-account.repository';
import { BankCredentialDrizzleRepository } from './bank-credential.repository';
import {
  DepositOrderDrizzleRepository,
  ownOrder,
} from './deposit-order.repository';
import { DepositOrderQueryRepository } from './deposit-order-query.repository';
import { IncomingCreditDrizzleRepository } from '../payments/incoming-credit.repository';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Integración de la Fase 4 (órdenes de consignación) contra Postgres real con RLS: emitir con tope
// de efectivo, "vista" una sola vez, reporte con comprobante, verificación que mueve el dinero y
// consume el ingreso bancario (sin doble ingreso), objeción con hilo completo y alcance.
const describeDb = hasDb() ? describe : describe.skip;

/** El comprobante se guarda en un bucket falso: MinIO no corre en las pruebas de integración. */
class TestDepositOrders extends DepositOrderDrizzleRepository {
  protected readonly files = { put: () => Promise.resolve({ sha256: 'test' }) };
}

const boxes = new CashBoxDrizzleRepository();
const accounts = new BankAccountDrizzleRepository(
  new BankCredentialDrizzleRepository(),
);
const orders = new TestDepositOrders();
const queries = new DepositOrderQueryRepository();
const credits = new IncomingCreditDrizzleRepository();

const CURRENCY = 'COP';
const JPEG = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff]),
  mimeType: 'image/jpeg',
};
const CASH = 300_000;

interface Fixture {
  tenant: string;
  collector: string;
  reviewer: string;
  route: string;
  bankBox: string;
  bankAccount: string;
}

async function seed(): Promise<Fixture> {
  const db = owner();
  const tenant = randomUUID();
  const collector = randomUUID();
  const zone = randomUUID();
  await db`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name)
    VALUES (${zone}, ${tenant}, NULL, 'norte', 'Norte')`;
  await db`INSERT INTO app_user (id, tenant_id, email, password_hash, role, zone_paths)
    VALUES (${collector}, ${tenant}, ${`c-${collector}@t.test`}, 'x', 'COLLECTOR', ${['norte']})`;
  const route = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Ruta',
    assignedTo: collector,
    zoneId: zone,
  });
  await db`
    INSERT INTO cash_transaction (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
    VALUES (${tenant}, ${route.id}, 'IN', 'ADJUSTMENT', ${CASH}, ${CURRENCY}, 'efectivo de prueba')`;
  const account = await accounts.create(tenant, {
    label: 'Inter Norte',
    bankName: 'Inter',
    countryCode: 'BR',
    bankCode: 'INTER',
    pixKey: `pix-${tenant}@t.test`,
  });
  const bank = await boxes.create(tenant, {
    type: 'BANK',
    name: 'Inter Norte',
    bankAccountId: account.id,
    zoneId: zone,
  });
  return {
    tenant,
    collector,
    reviewer: randomUUID(),
    route: route.id,
    bankBox: bank.id,
    bankAccount: account.id,
  };
}

const issue = (f: Fixture, amountMinor = 250_000) =>
  orders.issue({
    tenantId: f.tenant,
    issuedBy: f.reviewer,
    zoneScope: undefined,
    currency: CURRENCY,
    body: {
      collectorId: f.collector,
      amountMinor,
      destinationCashBoxId: f.bankBox,
    },
  });

const report = (f: Fixture, orderId: string, receipt = JPEG) =>
  orders.report({
    tenantId: f.tenant,
    collectorId: f.collector,
    orderId,
    fields: { amountMinor: 250_000, depositedAt: new Date().toISOString() },
    receipt,
    now: new Date(),
  });

const verify = (
  f: Fixture,
  orderId: string,
  bankCreditId?: string,
  zoneScope?: ReturnType<typeof sql>,
) =>
  orders.verify({
    tenantId: f.tenant,
    verifiedBy: f.reviewer,
    orderId,
    zoneScope,
    body: {
      verifiedAmountMinor: 250_000,
      ...(bankCreditId ? { bankCreditId } : {}),
    },
  });

async function bankCredit(f: Fixture, amountMinor: number): Promise<string> {
  const [row] = await owner()`
    INSERT INTO incoming_credit (tenant_id, bank_account_id, source_id, amount_minor, net_amount_minor,
      currency, payment_method_type, transaction_type, settlement_date)
    VALUES (${f.tenant}, ${f.bankAccount}, ${randomUUID()}, ${amountMinor}, ${amountMinor},
      ${CURRENCY}, 'bank_transfer', 'SETTLEMENT', now())
    RETURNING id`;
  return row.id as string;
}

async function balance(boxId: string): Promise<number> {
  const [row] = await owner()`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END), 0)::bigint AS b
    FROM cash_transaction WHERE cash_box_id = ${boxId}`;
  return Number(row.b);
}

const eventTypes = async (f: Fixture, orderId: string) =>
  (
    await queries.events({ tenantId: f.tenant, orderId, access: undefined })
  ).map((e) => e.type);

describeDb('Fase 4 — órdenes de consignación (integración)', () => {
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

  it('no se ordena más que el efectivo en poder del cobrador', async () => {
    const f = await setup();
    await expect(issue(f, CASH + 1)).rejects.toMatchObject({
      code: 'DEPOSIT_EXCEEDS_CASH',
    });
    const id = await issue(f);
    expect(await eventTypes(f, id)).toEqual(['ISSUED']);
  });

  it('abrirla la marca vista una sola vez', async () => {
    const f = await setup();
    const id = await issue(f);
    await orders.markSeen({
      tenantId: f.tenant,
      collectorId: f.collector,
      orderId: id,
    });
    await orders.markSeen({
      tenantId: f.tenant,
      collectorId: f.collector,
      orderId: id,
    });
    expect(await eventTypes(f, id)).toEqual(['ISSUED', 'SEEN']);
  });

  it('sin comprobante no hay reporte', async () => {
    const f = await setup();
    const id = await issue(f);
    await expect(
      report(f, id, { bytes: new Uint8Array(), mimeType: '' }),
    ).rejects.toThrow(DomainError);
  });

  it('verificar mueve el dinero y consume el ingreso bancario: la conciliación ya no lo ofrece', async () => {
    const f = await setup();
    const id = await issue(f);
    await report(f, id);
    const creditId = await bankCredit(f, 250_000);

    const matches = await queries.bankMatches({
      tenantId: f.tenant,
      orderId: id,
      access: undefined,
    });
    expect(matches.map((m) => m.id)).toEqual([creditId]);

    await verify(f, id, creditId);
    expect(await balance(f.route)).toBe(CASH - 250_000);
    expect(await balance(f.bankBox)).toBe(250_000);

    const free = await credits.listUnconsumed({
      tenantId: f.tenant,
      bankAccountId: f.bankAccount,
    });
    expect(free).toHaveLength(0);
    const view = await queries.get({
      tenantId: f.tenant,
      currency: CURRENCY,
      orderId: id,
      access: undefined,
    });
    expect(view).toMatchObject({
      status: 'VERIFIED',
      bankCreditId: creditId,
      verifiedAmountMinor: 250_000,
    });
  });

  it('no enlaza un ingreso de otro monto ni uno ya consumido (y nada se mueve)', async () => {
    const f = await setup();
    const first = await issue(f, 100_000);
    const second = await issue(f, 100_000);
    for (const id of [first, second]) await report(f, id);
    const wrongAmount = await bankCredit(f, 99_999);
    await expect(verify(f, first, wrongAmount)).rejects.toMatchObject({
      code: 'BANK_CREDIT_MISMATCH',
    });
    expect(await balance(f.route)).toBe(CASH);

    const good = await bankCredit(f, 250_000);
    await verify(f, first, good);
    await expect(verify(f, second, good)).rejects.toBeInstanceOf(ConflictError);
  });

  it('objeción y nuevo reporte: todo queda en el hilo', async () => {
    const f = await setup();
    const id = await issue(f);
    await report(f, id);
    await orders.close({
      tenantId: f.tenant,
      actorId: f.reviewer,
      orderId: id,
      zoneScope: undefined,
      action: 'DISPUTED',
      reason: 'El comprobante no es legible',
    });
    await orders.comment({
      tenantId: f.tenant,
      actorId: f.collector,
      orderId: id,
      access: ownOrder(f.collector),
      message: 'Adjunto uno más claro',
    });
    await report(f, id);
    expect(await eventTypes(f, id)).toEqual([
      'ISSUED',
      'REPORTED',
      'DISPUTED',
      'COMMENT',
      'REPORTED',
    ]);
  });

  it('RLS: otro tenant no ve la orden ni su hilo, y la bitácora no se edita ni se borra', async () => {
    const f = await setup();
    const other = await setup();
    const id = await issue(f);

    const seen = await withTenantTxFor(other.tenant, (tx) =>
      tx
        .select({ id: schema.fieldOrder.id })
        .from(schema.fieldOrder)
        .where(eq(schema.fieldOrder.id, id)),
    );
    expect(seen).toHaveLength(0);
    const events = await withTenantTxFor(other.tenant, (tx) =>
      tx
        .select({ id: schema.fieldOrderEvent.id })
        .from(schema.fieldOrderEvent)
        .where(eq(schema.fieldOrderEvent.orderId, id)),
    );
    expect(events).toHaveLength(0);

    await expect(
      withTenantTxFor(f.tenant, (tx) =>
        tx
          .update(schema.fieldOrderEvent)
          .set({ message: 'editado' })
          .where(eq(schema.fieldOrderEvent.orderId, id)),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenantTxFor(f.tenant, (tx) =>
        tx.delete(schema.fieldOrder).where(eq(schema.fieldOrder.id, id)),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('alcance: otro cobrador no la ve y un coordinador de otra zona no la verifica', async () => {
    const f = await setup();
    const id = await issue(f);
    await report(f, id);
    const other = await queries.list({
      tenantId: f.tenant,
      currency: CURRENCY,
      access: ownOrder(randomUUID()),
      page: 1,
      pageSize: 20,
    });
    expect(other.total).toBe(0);
    await expect(
      verify(f, id, undefined, sql`"zone"."path" <@ 'sur'::ltree`),
    ).rejects.toThrow('Orden no encontrada');
  });
});
