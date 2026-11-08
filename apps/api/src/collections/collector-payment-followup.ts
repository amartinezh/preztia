import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { needsVisit } from '@preztiaos/domain';
import type { Tx } from '../tenancy/unit-of-work';
import { tenantToday } from '../tenant-config/tenant-timezone';
import { daysSince } from './critical-clients.repository';
import { resolveOverdueThreshold } from './critical-overdue-threshold';

const AUDIT_ENTITY = 'collection-route';
const OPEN_STOP_STATUSES = ['ASSIGNED', 'SEEN'] as const;
// Texto que deja en la bitácora un abono tomado por el cobrador (lenguaje del operador).
const NOTE_LOCALE = 'es-CO';

/**
 * Visita con el nivel de mora al momento (base del reagendamiento por ciclo). Compartida por la
 * liquidación de una parada de ruta y por el abono del cobrador: una sola forma de "visitar".
 */
export async function recordVisitTx(
  tx: Tx,
  input: {
    tenantId: string;
    creditId: string;
    borrowerId: string;
    collectorId: string;
    today: string;
  },
): Promise<void> {
  const { overdueCount, earliestOverdue } = await overdueSnapshot(
    tx,
    input.creditId,
    input.today,
  );
  await tx.insert(schema.collectionVisit).values({
    tenantId: input.tenantId,
    creditId: input.creditId,
    borrowerId: input.borrowerId,
    collectorId: input.collectorId,
    overdueCountAtVisit: overdueCount,
    daysOverdueAtVisit: daysSince(earliestOverdue, input.today),
  });
}

/**
 * Lo que sigue a un ABONO EN EFECTIVO registrado por el COBRADOR, en la MISMA transacción del abono
 * (todo o nada): cobrar es un solo gesto, no tres pantallas.
 *  1. Si el coordinador le había despachado una parada de ruta para ese crédito, queda liquidada
 *     como "pagó" con el monto del abono (antes el cobrador tenía que liquidarla aparte y podía
 *     registrar el dinero dos veces).
 *  2. La bitácora de cobranza recibe la observación del abono (una sola línea de tiempo).
 *  3. Si el cliente estaba pendiente de visita por mora, el abono en persona cuenta como la visita
 *     (misma regla `needsVisit` del dominio; si no tocaba visitar, no se registra nada).
 * No se invoca en reintentos idempotentes (el llamador lo garantiza) ni cuando registra la oficina.
 */
export async function afterCollectorCashPaymentTx(
  tx: Tx,
  input: {
    tenantId: string;
    creditId: string;
    collectorId: string;
    paymentId: string;
    amountMinor: number;
  },
): Promise<void> {
  const [credit] = await tx
    .select({
      borrowerId: schema.credit.borrowerId,
      currency: schema.credit.currency,
    })
    .from(schema.credit)
    .where(eq(schema.credit.id, input.creditId));
  if (!credit) return;
  const today = await tenantToday(tx, input.tenantId);

  const stopResolved = await resolveOpenStopAsPaidTx(tx, input);

  const amountText = formatAmount(input.amountMinor, credit.currency);
  await tx.insert(schema.collectionNote).values({
    tenantId: input.tenantId,
    creditId: input.creditId,
    borrowerId: credit.borrowerId,
    authorId: input.collectorId,
    body: stopResolved
      ? `Abono en efectivo de ${amountText} · parada de ruta liquidada`
      : `Abono en efectivo de ${amountText}`,
  });

  const { overdueCount } = await overdueSnapshot(tx, input.creditId, today);
  const [lastVisit] = await tx
    .select({ overdueCountAtVisit: schema.collectionVisit.overdueCountAtVisit })
    .from(schema.collectionVisit)
    .where(eq(schema.collectionVisit.creditId, input.creditId))
    .orderBy(desc(schema.collectionVisit.visitedAt))
    .limit(1);
  const threshold = await resolveOverdueThreshold(tx, input.tenantId);
  const pendingVisit = needsVisit({
    overdueCount,
    threshold,
    lastVisitOverdueCount: lastVisit?.overdueCountAtVisit ?? null,
  });
  if (pendingVisit) {
    await recordVisitTx(tx, {
      tenantId: input.tenantId,
      creditId: input.creditId,
      borrowerId: credit.borrowerId,
      collectorId: input.collectorId,
      today,
    });
  }
}

/** Liquida como "pagó" la parada abierta del cobrador para ese crédito, si existe. */
async function resolveOpenStopAsPaidTx(
  tx: Tx,
  input: {
    tenantId: string;
    creditId: string;
    collectorId: string;
    paymentId: string;
    amountMinor: number;
  },
): Promise<boolean> {
  const [stop] = await tx
    .select({ id: schema.routeStop.id })
    .from(schema.routeStop)
    .where(
      and(
        eq(schema.routeStop.creditId, input.creditId),
        eq(schema.routeStop.collectorId, input.collectorId),
        inArray(schema.routeStop.status, [...OPEN_STOP_STATUSES]),
      ),
    )
    .for('update');
  if (!stop) return false;

  const now = new Date();
  await tx
    .update(schema.routeStop)
    .set({
      status: 'RESOLVED',
      outcome: 'PAID',
      collectedMinor: input.amountMinor,
      note: 'Liquidada automáticamente al registrar el abono',
      paymentId: input.paymentId,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.routeStop.id, stop.id));
  await tx.insert(schema.auditLog).values({
    tenantId: input.tenantId,
    actorId: input.collectorId,
    action: 'RESOLVE route-stop',
    entity: AUDIT_ENTITY,
    entityId: stop.id,
    payload: {
      outcome: 'PAID',
      collectedMinor: input.amountMinor,
      source: 'cash-payment',
    },
  });
  return true;
}

async function overdueSnapshot(
  tx: Tx,
  creditId: string,
  today: string,
): Promise<{ overdueCount: number; earliestOverdue: string | null }> {
  const installments = await tx
    .select({
      dueDate: schema.installment.dueDate,
      amountDueMinor: schema.installment.amountDueMinor,
      paidMinor: schema.installment.paidMinor,
    })
    .from(schema.installment)
    .where(eq(schema.installment.creditId, creditId));
  const overdue = installments.filter(
    (i) => i.dueDate < today && i.paidMinor < i.amountDueMinor,
  );
  const earliestOverdue = overdue.map((i) => i.dueDate).sort()[0] ?? null;
  return { overdueCount: overdue.length, earliestOverdue };
}

function formatAmount(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(NOTE_LOCALE, {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}
