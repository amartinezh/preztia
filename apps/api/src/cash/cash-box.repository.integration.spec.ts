import { randomUUID } from 'node:crypto';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { owner, cleanupTenant, closeOwner, hasDb } from '../../test/db-helpers';

// Tests de integración del libro mayor: golpean Postgres real como rol `app` (RLS real) para
// verificar las garantías de integridad financiera que ningún test de dominio puede cubrir:
// el advisory lock anti-sobregiro, el balanceo de transferencias y el aislamiento por tenant.
const describeDb = hasDb() ? describe : describe.skip;

const repo = new CashBoxDrizzleRepository();
const actor = randomUUID();

async function balanceOf(boxId: string): Promise<number> {
  const [row] = await owner()`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END), 0) AS bal
    FROM cash_transaction WHERE cash_box_id = ${boxId}`;
  return Number(row.bal);
}

describeDb('CashBoxDrizzleRepository (integración)', () => {
  const tenants: string[] = [];

  function newTenant(): string {
    const id = randomUUID();
    tenants.push(id);
    return id;
  }

  /** Crea una caja menor con un saldo inicial sembrado vía un ingreso. */
  async function seedCashBox(
    tenantId: string,
    initialMinor: number,
  ): Promise<string> {
    const box = await repo.create(tenantId, {
      type: 'CASH',
      name: 'Caja test',
    });
    if (initialMinor > 0) {
      await repo.post({
        tenantId,
        cashBoxId: box.id,
        direction: 'IN',
        kind: 'PAYMENT_IN',
        amountMinor: initialMinor,
        reason: 'saldo inicial',
        createdBy: actor,
      });
    }
    return box.id;
  }

  afterAll(async () => {
    for (const t of tenants) await cleanupTenant(t);
    await closeOwner();
  });

  it('rechaza un retiro que excede el saldo y deja el saldo intacto', async () => {
    const tenant = newTenant();
    const box = await seedCashBox(tenant, 50000);

    await expect(
      repo.post({
        tenantId: tenant,
        cashBoxId: box,
        direction: 'OUT',
        kind: 'WITHDRAWAL',
        amountMinor: 60000,
        reason: 'retiro inválido',
        createdBy: actor,
      }),
    ).rejects.toThrow(/insuficiente/i);

    expect(await balanceOf(box)).toBe(50000);
  });

  it('exige motivo en la caja menor (regla de dominio en la frontera)', async () => {
    const tenant = newTenant();
    const box = await seedCashBox(tenant, 0);
    await expect(
      repo.post({
        tenantId: tenant,
        cashBoxId: box,
        direction: 'IN',
        kind: 'PAYMENT_IN',
        amountMinor: 1000,
        reason: null,
        createdBy: actor,
      }),
    ).rejects.toThrow(/motivo/i);
  });

  it('el advisory lock serializa retiros concurrentes: nunca sobregira', async () => {
    const tenant = newTenant();
    const box = await seedCashBox(tenant, 50000);

    // Dos retiros de 30.000 a la vez: solo uno cabe (50.000). Sin el lock, ambos leerían
    // 50.000 y el saldo terminaría en -10.000.
    const out = () =>
      repo.post({
        tenantId: tenant,
        cashBoxId: box,
        direction: 'OUT',
        kind: 'WITHDRAWAL',
        amountMinor: 30000,
        reason: 'retiro concurrente',
        createdBy: actor,
      });
    const results = await Promise.allSettled([out(), out()]);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    expect(ok).toBe(1);
    expect(failed).toBe(1);
    expect(await balanceOf(box)).toBe(20000);
  });

  it('una transferencia produce dos asientos balanceados (Σ = 0) con el mismo grupo', async () => {
    const tenant = newTenant();
    const from = await seedCashBox(tenant, 40000);
    const to = await repo.create(tenant, { type: 'CASH', name: 'Destino' });

    await repo.transfer({
      tenantId: tenant,
      fromBoxId: from,
      toBoxId: to.id,
      amountMinor: 15000,
      reason: 'transferencia',
      createdBy: actor,
    });

    expect(await balanceOf(from)).toBe(25000);
    expect(await balanceOf(to.id)).toBe(15000);

    const rows = await owner()`
      SELECT transfer_group_id FROM cash_transaction
      WHERE cash_box_id IN (${from}, ${to.id}) AND kind = 'TRANSFER'`;
    expect(rows).toHaveLength(2);
    expect(rows[0].transfer_group_id).toBe(rows[1].transfer_group_id);
  });

  it('RLS aísla por tenant: otro tenant no ve ni puede postear en la caja', async () => {
    const tenantA = newTenant();
    const tenantB = newTenant();
    const box = await seedCashBox(tenantA, 10000);

    const listB = await repo.list(tenantB);
    expect(listB.find((b) => b.id === box)).toBeUndefined();

    await expect(
      repo.post({
        tenantId: tenantB,
        cashBoxId: box,
        direction: 'IN',
        kind: 'PAYMENT_IN',
        amountMinor: 1000,
        reason: 'intruso',
        createdBy: actor,
      }),
    ).rejects.toThrow(/no encontrada/i);
  });
});
