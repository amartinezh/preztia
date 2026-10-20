import { sql } from 'drizzle-orm';
import { type Db } from '@preztiaos/db';
import { withTenantTxFor } from '../../src/tenancy/unit-of-work';
import {
  loadRouteBoxState,
  resolveRemittanceSchedule,
} from '../../src/cash/route-box-state';
import type { TenantContext } from './context';

// VERIFICACIÓN de los invariantes de negocio sobre lo que quedó en la base (no sobre la memoria):
// cada consulta debe devolver cero filas. Un seed que no los cumple falla: los datos de prueba
// tienen que ser datos que el sistema pudo haber producido.

interface Invariant {
  readonly name: string;
  readonly query: ReturnType<typeof sql>;
}

const INVARIANTS: readonly Invariant[] = [
  {
    name: 'El saldo de una caja nunca fue negativo (Σ firmado acumulado por created_at)',
    query: sql`
      SELECT cash_box_id FROM (
        SELECT cash_box_id, SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END)
          OVER (PARTITION BY cash_box_id ORDER BY created_at, (direction = 'OUT'), id) AS running
        FROM cash_transaction) t
      WHERE running < 0 GROUP BY cash_box_id`,
  },
  {
    name: 'Σ asignaciones de cada cuota = paid_minor y 0 ≤ paid ≤ due',
    query: sql`
      SELECT i.id FROM installment i
      LEFT JOIN payment_allocation pa ON pa.installment_id = i.id
      GROUP BY i.id, i.paid_minor, i.amount_due_minor
      HAVING COALESCE(SUM(pa.amount_minor), 0) <> i.paid_minor OR i.paid_minor > i.amount_due_minor OR i.paid_minor < 0`,
  },
  {
    name: 'Estado de cada cuota coherente con lo pagado (PENDING / PARTIALLY_PAID / PAID)',
    query: sql`
      SELECT id FROM installment WHERE NOT (
        (status = 'PAID' AND paid_minor = amount_due_minor) OR
        (status = 'PARTIALLY_PAID' AND paid_minor > 0 AND paid_minor < amount_due_minor) OR
        (status = 'PENDING' AND paid_minor = 0))`,
  },
  {
    name: 'Σ cuotas de cada crédito = capital × (1 + interés) (redondeo en la última)',
    query: sql`
      SELECT c.id FROM credit c JOIN installment i ON i.credit_id = c.id
      GROUP BY c.id, c.principal_minor, c.interest_pct, c.installments_count
      HAVING SUM(i.amount_due_minor) <> FLOOR(c.principal_minor * (1000 + c.interest_pct) / 1000.0)
          OR COUNT(*) <> c.installments_count`,
  },
  {
    name: 'Crédito otorgado = exactamente un DESEMBOLSO por su capital; migrado = ninguno',
    query: sql`
      SELECT c.id FROM credit c
      LEFT JOIN cash_transaction t ON t.credit_id = c.id AND t.kind = 'DISBURSEMENT'
      GROUP BY c.id, c.origin, c.principal_minor
      HAVING (c.origin = 'ORIGINATED' AND (COUNT(t.id) <> 1 OR SUM(t.amount_minor) <> c.principal_minor))
          OR (c.origin = 'MIGRATED' AND COUNT(t.id) <> 0)`,
  },
  {
    name: 'Pago VERIFIED no histórico = un solo asiento de entrada; histórico o no verificado = ninguno',
    query: sql`
      SELECT p.id FROM payment p
      LEFT JOIN cash_transaction t ON t.payment_id = p.id
      GROUP BY p.id, p.status, p.historical
      HAVING (p.status = 'VERIFIED' AND NOT p.historical AND COUNT(t.id) <> 1)
          OR ((p.status <> 'VERIFIED' OR p.historical) AND COUNT(t.id) <> 0)`,
  },
  {
    name: 'Lo abonado de un pago = lo que entró a la caja (sin sobrepago)',
    query: sql`
      SELECT p.id FROM payment p
      JOIN cash_transaction t ON t.payment_id = p.id
      LEFT JOIN payment_allocation pa ON pa.payment_id = p.id
      GROUP BY p.id, t.amount_minor
      HAVING COALESCE(SUM(pa.amount_minor), 0) > t.amount_minor`,
  },
  {
    name: 'Cada transferencia tiene dos patas que suman cero',
    query: sql`
      SELECT transfer_group_id FROM cash_transaction WHERE transfer_group_id IS NOT NULL
      GROUP BY transfer_group_id
      HAVING COUNT(*) <> 2 OR SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END) <> 0`,
  },
  {
    name: 'Gasto aprobado = un asiento EXPENSE por su monto; pendiente o rechazado = ninguno',
    query: sql`
      SELECT e.id FROM expense e LEFT JOIN cash_transaction t ON t.expense_id = e.id
      GROUP BY e.id, e.status, e.amount_minor
      HAVING (e.status = 'APPROVED' AND (COUNT(t.id) <> 1 OR SUM(t.amount_minor) <> e.amount_minor))
          OR (e.status <> 'APPROVED' AND COUNT(t.id) <> 0)`,
  },
  {
    name: 'Crédito SETTLED sin saldo pendiente',
    query: sql`
      SELECT c.id FROM credit c JOIN installment i ON i.credit_id = c.id
      WHERE c.status = 'SETTLED' GROUP BY c.id HAVING SUM(i.amount_due_minor - i.paid_minor) <> 0`,
  },
  {
    name: 'Crédito ACTIVE con saldo pendiente (saldado ⇒ SETTLED)',
    query: sql`
      SELECT c.id FROM credit c JOIN installment i ON i.credit_id = c.id
      WHERE c.status = 'ACTIVE' GROUP BY c.id HAVING SUM(i.amount_due_minor - i.paid_minor) = 0`,
  },
  {
    name: 'Consignación VERIFIED con su transferencia ruta → banco por lo verificado',
    query: sql`
      SELECT o.id FROM field_order o
      LEFT JOIN cash_transaction t ON t.transfer_group_id = o.transfer_group_id AND t.direction = 'OUT'
      WHERE o.status = 'VERIFIED' AND (t.id IS NULL OR t.amount_minor <> o.verified_amount_minor OR t.cash_box_id <> o.route_cash_box_id)`,
  },
  {
    name: 'Comisión pagada = la causada en la foto sellada (una vez por cobrador y período)',
    query: sql`
      SELECT t.id FROM cash_transaction t
      JOIN settlement_period s ON s.id = t.settlement_period_id
      CROSS JOIN LATERAL jsonb_array_elements(s.snapshot->'collectors') AS c
      WHERE t.kind = 'COMMISSION' AND c->>'collectorId' = t.collector_id::text
        AND (c->'commission'->>'amountMinor')::bigint <> t.amount_minor`,
  },
  {
    name: 'Una caja inactiva no conserva saldo',
    query: sql`
      SELECT b.id FROM cash_box b LEFT JOIN cash_transaction t ON t.cash_box_id = b.id
      WHERE NOT b.active GROUP BY b.id
      HAVING COALESCE(SUM(CASE WHEN t.direction = 'IN' THEN t.amount_minor ELSE -t.amount_minor END), 0) <> 0`,
  },
  {
    name: 'Foto de liquidación: apertura + entradas − salidas = cierre (totales)',
    query: sql`
      SELECT id FROM settlement_period
      WHERE (snapshot->'totals'->>'openingMinor')::bigint + (snapshot->'totals'->>'inMinor')::bigint
          - (snapshot->'totals'->>'outMinor')::bigint <> (snapshot->'totals'->>'closingMinor')::bigint`,
  },
  {
    name: 'Los períodos de liquidación se encadenan sin huecos ni solapes',
    query: sql`
      SELECT id FROM (
        SELECT id, period_start, LAG(period_end) OVER (PARTITION BY tenant_id ORDER BY period_start) AS prev_end
        FROM settlement_period) s
      WHERE prev_end IS NOT NULL AND prev_end <> period_start`,
  },
  {
    name: 'Ningún hecho quedó con fecha futura',
    query: sql`
      SELECT 'cash_transaction' FROM cash_transaction WHERE created_at > now()
      UNION ALL SELECT 'payment' FROM payment WHERE created_at > now()
      UNION ALL SELECT 'conversation_message' FROM conversation_message WHERE created_at > now()`,
  },
];

export interface VerificationReport {
  readonly passed: string[];
  readonly failed: Array<{ name: string; rows: number }>;
}

export async function verifySeed(
  db: Db,
  contexts: readonly TenantContext[],
): Promise<VerificationReport> {
  const report: VerificationReport = { passed: [], failed: [] };
  for (const invariant of INVARIANTS) {
    const rows = (await db.execute(invariant.query)) as unknown as unknown[];
    if (rows.length === 0) report.passed.push(invariant.name);
    else report.failed.push({ name: invariant.name, rows: rows.length });
  }
  await verifyRouteBoxes(contexts, report);
  await verifyMemoryMatchesDb(db, contexts, report);
  return report;
}

/** La rendición de cada caja de ruta reconstruida por la API cuadra con el libro (rol app + RLS). */
async function verifyRouteBoxes(
  contexts: readonly TenantContext[],
  report: VerificationReport,
): Promise<void> {
  const name =
    'Rendición de cada caja de ruta: esperado (corte + movimientos) = saldo del libro';
  try {
    for (const ctx of contexts) {
      for (const box of [...ctx.boxes.values()].filter((b) => b.assignedTo)) {
        await withTenantTxFor(ctx.tenantId, async (tx) =>
          loadRouteBoxState(tx, {
            cashBoxId: box.id,
            collectorId: box.assignedTo!,
            now: new Date(),
            schedule: await resolveRemittanceSchedule(tx, ctx.tenantId),
          }),
        );
      }
    }
    report.passed.push(name);
  } catch (err) {
    report.failed.push({
      name: `${name}: ${err instanceof Error ? err.message : String(err)}`,
      rows: 1,
    });
  }
}

/** El saldo que la simulación llevó en memoria es el mismo que deriva la base. */
async function verifyMemoryMatchesDb(
  db: Db,
  contexts: readonly TenantContext[],
  report: VerificationReport,
): Promise<void> {
  const name = 'Saldo en memoria de cada caja = Σ del libro en la base';
  const rows = (await db.execute(sql`
    SELECT cash_box_id, SUM(CASE WHEN direction = 'IN' THEN amount_minor ELSE -amount_minor END) AS balance
    FROM cash_transaction GROUP BY cash_box_id
  `)) as unknown as Array<{ cash_box_id: string; balance: string }>;
  const fromDb = new Map(rows.map((r) => [r.cash_box_id, Number(r.balance)]));
  const mismatched = contexts.flatMap((ctx) =>
    [...ctx.boxes.values()].filter(
      (b) => (fromDb.get(b.id) ?? 0) !== b.balance,
    ),
  );
  if (mismatched.length === 0) report.passed.push(name);
  else report.failed.push({ name, rows: mismatched.length });
}
