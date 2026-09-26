import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  ConflictError,
  assertCanPost,
  assertCanSubmitRemittance,
  assertZoneCanUseBox,
  assessReception,
  buildDebtClosure,
  businessDateOf,
  type DebtClosureType,
} from '@preztiaos/domain';
import type {
  ReceiveRemittanceInput,
  RemittanceView,
  SubmitRemittanceInput,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { attributionFor, balanceOfBox, lockCashBox } from './cash-ledger';
import { findRouteBox } from './payment-box-router';
import { postTransferTx } from './cash-box.repository';
import {
  loadRouteBoxState,
  resolveRemittanceSchedule,
  toRemittanceView,
} from './route-box-state';

const DELIVERY_REASON = 'Entrega de rendición del cobrador';
const AUDIT_ENTITY = 'collector-remittance';

/**
 * Escrituras de la RENDICIÓN del cobrador. Cada operación corre en UNA transacción bajo el candado
 * de la caja de ruta: leer el estado (saldo, corte, obligación) y escribir quedan atómicos. Las
 * reglas las decide el dominio (`remittance.ts`); aquí solo se orquesta la persistencia y el
 * dinero se mueve en el libro (TRANSFER / DEBT_CLOSURE). Todo cambio de estado va a `audit_log`.
 */
@Injectable()
export class RemittanceDrizzleRepository {
  /** El cobrador declara lo que entrega (SUBMITTED). */
  async submit(input: {
    tenantId: string;
    collectorId: string;
    currency: string;
    body: SubmitRemittanceInput;
    now: Date;
  }): Promise<RemittanceView> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const box = await requireRouteBox(tx, input.collectorId, input.currency);
      await lockCashBox(tx, box.id);
      const schedule = await resolveRemittanceSchedule(tx, input.tenantId);
      const state = await loadRouteBoxState(tx, {
        cashBoxId: box.id,
        collectorId: input.collectorId,
        now: input.now,
        schedule,
      });
      assertCanSubmitRemittance({
        hasOpenSubmission: state.open !== null,
        hasUnremittedCollections: state.hasUnremittedCollections,
        balanceMinor: state.balanceMinor,
        declaredMinor: input.body.declaredMinor,
      });

      const [row] = await tx
        .insert(schema.collectorRemittance)
        .values({
          tenantId: input.tenantId,
          collectorId: input.collectorId,
          cashBoxId: box.id,
          zoneId: box.zoneId,
          businessDate: businessDateOf(input.now, schedule.timeZone),
          dueAt: state.obligation.dueAt,
          summary: state.summary,
          declaredMinor: input.body.declaredMinor,
          collectorNote: input.body.note ?? null,
        })
        .returning();
      await audit(tx, {
        tenantId: input.tenantId,
        actorId: input.collectorId,
        action: 'SUBMIT collector-remittance',
        entityId: row.id,
        payload: {
          declaredMinor: row.declaredMinor,
          expectedMinor: state.summary.expectedMinor,
          lateMinutes: state.obligation.lateMinutes,
        },
      });
      return toRemittanceView(row);
    });
  }

  /**
   * El coordinador cuenta y recibe: TRANSFER ruta → caja de oficina por lo contado. El faltante
   * queda en la caja de ruta (deuda). El corte se sella con `clock_timestamp()` bajo el candado:
   * todo lo registrado antes quedó en el saldo recibido; lo posterior es de la siguiente rendición.
   */
  async receive(input: {
    tenantId: string;
    remittanceId: string;
    receivedBy: string;
    zoneScope: SQL | undefined;
    body: ReceiveRemittanceInput;
  }): Promise<RemittanceView> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const open = await loadOpenInScope(
        tx,
        input.remittanceId,
        input.zoneScope,
      );
      await lockCashBox(tx, open.cashBoxId);

      const expectedMinor = await balanceOfBox(tx, open.cashBoxId);
      const { shortfallMinor } = assessReception({
        expectedMinor,
        countedMinor: input.body.countedMinor,
      });

      let transferGroupId: string | null = null;
      if (input.body.countedMinor > 0) {
        const destinationId = input.body.destinationCashBoxId;
        if (!destinationId) {
          throw new BadRequestException(
            'Elige la caja de oficina que recibe el efectivo',
          );
        }
        await assertValidDestination(tx, open.cashBoxId, destinationId);
        ({ transferGroupId } = await postTransferTx(tx, {
          tenantId: input.tenantId,
          fromBoxId: open.cashBoxId,
          toBoxId: destinationId,
          amountMinor: input.body.countedMinor,
          reason: DELIVERY_REASON,
          createdBy: input.receivedBy,
        }));
      }

      const closingBalanceMinor = await balanceOfBox(tx, open.cashBoxId);
      const [row] = await tx
        .update(schema.collectorRemittance)
        .set({
          status: 'RECEIVED',
          receivedBy: input.receivedBy,
          receivedAt: new Date(),
          destinationCashBoxId: input.body.destinationCashBoxId ?? null,
          expectedAtReceptionMinor: expectedMinor,
          countedMinor: input.body.countedMinor,
          shortfallMinor,
          closingBalanceMinor,
          cutAt: sql`clock_timestamp()`,
          receiverNote: input.body.note ?? null,
          transferGroupId,
        })
        .where(eq(schema.collectorRemittance.id, open.id))
        .returning();
      await audit(tx, {
        tenantId: input.tenantId,
        actorId: input.receivedBy,
        action: 'RECEIVE collector-remittance',
        entityId: row.id,
        payload: {
          expectedMinor,
          countedMinor: input.body.countedMinor,
          shortfallMinor,
        },
      });
      return toRemittanceView(row);
    });
  }

  /** Cierre de deuda del cobrador (solo ADMIN): asiento DEBT_CLOSURE en su caja de ruta. */
  async closeDebt(input: {
    tenantId: string;
    collectorId: string;
    currency: string;
    closedBy: string;
    type: DebtClosureType;
    amountMinor: number;
    reason: string;
    now: Date;
  }): Promise<{ transactionId: string; carriedDebtMinor: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const box = await requireRouteBox(tx, input.collectorId, input.currency);
      await lockCashBox(tx, box.id);
      const state = await loadRouteBoxState(tx, {
        cashBoxId: box.id,
        collectorId: input.collectorId,
        now: input.now,
        schedule: await resolveRemittanceSchedule(tx, input.tenantId),
      });
      const intent = buildDebtClosure({
        debtMinor: state.carriedDebtMinor,
        amountMinor: input.amountMinor,
        type: input.type,
        reason: input.reason,
        remittanceInProgress: state.open !== null,
      });
      assertCanPost({
        type: 'CASH',
        currentBalanceMinor: state.balanceMinor,
        intent,
      });

      const attribution = await attributionFor(tx, box.id);
      const [posted] = await tx
        .insert(schema.cashTransaction)
        .values({
          tenantId: input.tenantId,
          cashBoxId: box.id,
          ...intent,
          currency: input.currency,
          debtClosureType: input.type,
          ...attribution,
          createdBy: input.closedBy,
        })
        .returning({ id: schema.cashTransaction.id });
      await audit(tx, {
        tenantId: input.tenantId,
        actorId: input.closedBy,
        action: 'CLOSE collector-debt',
        entityId: input.collectorId,
        payload: { type: input.type, amountMinor: input.amountMinor },
      });
      return {
        transactionId: posted.id,
        carriedDebtMinor: state.carriedDebtMinor - input.amountMinor,
      };
    });
  }
}

async function requireRouteBox(
  tx: Tx,
  collectorId: string,
  currency: string,
): Promise<{ id: string; zoneId: string | null }> {
  const boxId = await findRouteBox(tx, collectorId, currency);
  if (!boxId) {
    throw new ConflictError(
      'El cobrador no tiene una caja de ruta activa',
      'NO_ROUTE_CASH_BOX',
    );
  }
  const [box] = await tx
    .select({ id: schema.cashBox.id, zoneId: schema.cashBox.zoneId })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.id, boxId))
    .limit(1);
  return box;
}

/**
 * Rendición abierta (SUBMITTED) dentro del alcance del coordinador, bloqueada para la recepción.
 * Fuera de alcance responde 404 (no se revela su existencia).
 */
async function loadOpenInScope(
  tx: Tx,
  remittanceId: string,
  zoneScope: SQL | undefined,
): Promise<typeof schema.collectorRemittance.$inferSelect> {
  const [row] = await tx
    .select()
    .from(schema.collectorRemittance)
    .leftJoin(
      schema.zone,
      eq(schema.zone.id, schema.collectorRemittance.zoneId),
    )
    .where(and(eq(schema.collectorRemittance.id, remittanceId), zoneScope))
    .for('update', { of: schema.collectorRemittance });
  if (!row) throw new NotFoundException('Rendición no encontrada');
  const remittance = row.collector_remittance;
  if (remittance.status !== 'SUBMITTED') {
    throw new ConflictError(
      'La rendición ya fue recibida',
      'REMITTANCE_NOT_OPEN',
    );
  }
  return remittance;
}

/** La caja que recibe es de oficina (efectivo, sin cobrador) y la zona del cobrador puede usarla. */
async function assertValidDestination(
  tx: Tx,
  routeBoxId: string,
  destinationId: string,
): Promise<void> {
  const [destination] = await tx
    .select({
      type: schema.cashBox.type,
      assignedTo: schema.cashBox.assignedTo,
      zonePath: schema.zone.path,
    })
    .from(schema.cashBox)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.cashBox.zoneId))
    .where(eq(schema.cashBox.id, destinationId))
    .limit(1);
  if (!destination)
    throw new NotFoundException('Caja de destino no encontrada');
  if (destination.type !== 'CASH' || destination.assignedTo !== null) {
    throw new ConflictError(
      'La entrega se recibe en una caja de oficina (efectivo, sin cobrador)',
      'INVALID_REMITTANCE_DESTINATION',
    );
  }
  const [route] = await tx
    .select({ zonePath: schema.zone.path })
    .from(schema.cashBox)
    .innerJoin(schema.zone, eq(schema.zone.id, schema.cashBox.zoneId))
    .where(eq(schema.cashBox.id, routeBoxId))
    .limit(1);
  if (route) assertZoneCanUseBox(route.zonePath, destination.zonePath ?? null);
}

async function audit(
  tx: Tx,
  input: {
    tenantId: string;
    actorId: string;
    action: string;
    entityId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    entity: AUDIT_ENTITY,
    entityId: input.entityId,
    payload: input.payload,
  });
}
