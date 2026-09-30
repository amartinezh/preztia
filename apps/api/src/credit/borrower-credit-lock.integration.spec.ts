import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  CREDIT_DENIED_BLOCKED,
  CREDIT_DENIED_OVER_LIMIT,
  NotFoundError,
} from '@preztiaos/domain';
import { CashBoxDrizzleRepository } from '../cash/cash-box.repository';
import { CreditDrizzleRepository } from './credit.repository';
import { tenantStorage } from '../tenancy/tenant-context';
import {
  owner,
  cleanupTenant,
  closeOwner,
  hasDb,
  seedBorrower,
} from '../../test/db-helpers';

// Garantía final de cupo/bloqueo: la transacción que crea el crédito bloquea la fila del cliente
// y re-verifica la regla del dominio. Contra Postgres real con RLS (rol `app`), incluida la carrera
// de dos otorgamientos simultáneos al mismo cliente que la verificación previa no puede frenar.
const describeDb = hasDb() ? describe : describe.skip;

const boxes = new CashBoxDrizzleRepository();
const credits = new CreditDrizzleRepository();

const CURRENCY = 'COP';
const PRINCIPAL = 100_000;
// 20% plano → total 120.000 en 2 cuotas: es lo que suma al saldo vigente del cliente.
const INSTALLMENT_DUE = 60_000;
// Cabe UN crédito (0 + 100.000 ≤ 150.000) pero no dos (120.000 + 100.000 > 150.000).
const LIMIT_FOR_ONE_CREDIT = 150_000;
const OFFICE_FUNDS = 1_000_000;

interface Fixture {
  tenant: string;
  zone: string;
  office: string;
}

async function seedFixture(): Promise<Fixture> {
  const tenant = randomUUID();
  const zone = randomUUID();
  await owner()`INSERT INTO zone (id, tenant_id, parent_zone_id, path, name)
    VALUES (${zone}, ${tenant}, NULL, 'norte', 'Norte')`;
  const office = await boxes.create(tenant, {
    type: 'CASH',
    name: 'Oficina Norte',
    zoneId: zone,
  });
  await owner()`
    INSERT INTO cash_transaction (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
    VALUES (${tenant}, ${office.id}, 'IN', 'ADJUSTMENT', ${OFFICE_FUNDS}, ${CURRENCY}, 'saldo inicial de prueba')`;
  return { tenant, zone, office: office.id };
}

function grant(f: Fixture, borrowerId: string): Promise<void> {
  return tenantStorage.run({ tenantId: f.tenant }, () =>
    credits.save(
      {
        id: randomUUID(),
        tenantId: f.tenant,
        borrowerId,
        zoneId: f.zone,
        principalMinor: PRINCIPAL,
        interestPct: 200,
        installmentsCount: 2,
        frequency: 'DAILY',
        currency: CURRENCY,
        startDate: '2026-09-29',
        endDate: '2026-10-01',
      },
      [
        { seq: 1, amountDueMinor: INSTALLMENT_DUE, dueDate: '2026-09-30' },
        { seq: 2, amountDueMinor: INSTALLMENT_DUE, dueDate: '2026-10-01' },
      ],
      { cashBoxId: f.office, grantedBy: randomUUID() },
    ),
  );
}

async function creditsOf(borrowerId: string): Promise<number> {
  const [{ n }] = await owner()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM credit WHERE borrower_id = ${borrowerId}`;
  return n;
}

async function balance(boxId: string): Promise<number> {
  const [{ b }] = await owner()<{ b: number }[]>`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END), 0)::int AS b
    FROM cash_transaction WHERE cash_box_id = ${boxId}`;
  return b;
}

describeDb(
  'Cupo y bloqueo del cliente dentro de la transacción (integración)',
  () => {
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
        await sql`DELETE FROM borrower WHERE tenant_id = ${f.tenant}`;
        await sql`DELETE FROM zone WHERE tenant_id = ${f.tenant}`;
      }
      await closeOwner();
    });

    it('dos otorgamientos simultáneos que juntos exceden el cupo: solo uno queda', async () => {
      const f = await setup();
      const borrower = await seedBorrower(f.tenant, {
        creditLimitMinor: LIMIT_FOR_ONE_CREDIT,
      });

      const results = await Promise.allSettled([
        grant(f, borrower),
        grant(f, borrower),
      ]);

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
      expect(rejected[0].reason).toMatchObject({
        code: CREDIT_DENIED_OVER_LIMIT,
      });
      // El rechazado se revirtió completo: un solo crédito y un solo desembolso.
      expect(await creditsOf(borrower)).toBe(1);
      expect(await balance(f.office)).toBe(OFFICE_FUNDS - PRINCIPAL);
    });

    it('cliente bloqueado: 409 y no sale dinero de la caja', async () => {
      const f = await setup();
      const borrower = await seedBorrower(f.tenant, { creditBlocked: true });

      await expect(grant(f, borrower)).rejects.toMatchObject({
        code: CREDIT_DENIED_BLOCKED,
      });
      expect(await creditsOf(borrower)).toBe(0);
      expect(await balance(f.office)).toBe(OFFICE_FUNDS);
    });

    it('sin cupo (0) no limita: dos créditos simultáneos quedan', async () => {
      const f = await setup();
      const borrower = await seedBorrower(f.tenant);

      await Promise.all([grant(f, borrower), grant(f, borrower)]);

      expect(await creditsOf(borrower)).toBe(2);
    });

    it('cliente inexistente: 404 y nada queda registrado', async () => {
      const f = await setup();
      const ghost = randomUUID();

      await expect(grant(f, ghost)).rejects.toBeInstanceOf(NotFoundError);
      expect(await creditsOf(ghost)).toBe(0);
    });
  },
);
