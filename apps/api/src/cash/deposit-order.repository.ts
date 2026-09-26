import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  ConflictError,
  assertCanIssueDeposit,
  assertValidReceiptFile,
  assertZoneCanUseBox,
  cancelOrder,
  disputeDeposit,
  markSeen,
  reportDeposit,
  verifyDeposit,
  type FieldOrderStatus,
} from '@preztiaos/domain';
import type {
  IssueDepositOrderInput,
  ReportDepositFields,
  VerifyDepositInput,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { EncryptedFileBucket } from '../shared/encrypted-file-bucket';
import { balanceOfBox, lockCashBox } from './cash-ledger';
import { findRouteBox } from './payment-box-router';
import { postTransferTx } from './cash-box.repository';

type OrderRow = typeof schema.fieldOrder.$inferSelect;
type EventType = (typeof schema.fieldOrderEventType.enumValues)[number];

const DEPOSIT_REASON = 'Consignación del cobrador a la cuenta';
const AUDIT_ENTITY = 'field-order';

/**
 * Escrituras de las ÓRDENES DE CONSIGNACIÓN. Cada acción es una transacción: lee la orden con
 * FOR UPDATE, aplica la transición del dominio (`deposit-order.ts`), persiste el estado vigente y
 * agrega el evento a la bitácora append-only. Verificar mueve el dinero en el libro (TRANSFER ruta
 * → banco) y consume el ingreso bancario enlazado para que la conciliación de pagos lo ignore.
 * `access` acota: el cobrador solo sus órdenes; el coordinador su subárbol; el ADMIN todo.
 */
@Injectable()
export class DepositOrderDrizzleRepository {
  // `protected` para que las pruebas de integración lo reemplacen (MinIO no corre en ellas).
  protected readonly files: Pick<EncryptedFileBucket, 'put'> =
    new EncryptedFileBucket();

  async issue(input: {
    tenantId: string;
    issuedBy: string;
    zoneScope: SQL | undefined;
    currency: string;
    body: IssueDepositOrderInput;
  }): Promise<string> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const route = await routeBoxInScope(
        tx,
        input.body.collectorId,
        input.currency,
        input.zoneScope,
      );
      await lockCashBox(tx, route.id);
      assertCanIssueDeposit({
        amountMinor: input.body.amountMinor,
        cashInHandMinor: await balanceOfBox(tx, route.id),
      });
      await assertValidDestination(
        tx,
        route.zonePath,
        input.body.destinationCashBoxId,
      );

      const [order] = await tx
        .insert(schema.fieldOrder)
        .values({
          tenantId: input.tenantId,
          kind: 'DEPOSIT',
          collectorId: input.body.collectorId,
          routeCashBoxId: route.id,
          zoneId: route.zoneId,
          destinationCashBoxId: input.body.destinationCashBoxId,
          amountMinor: input.body.amountMinor,
          instructions: input.body.instructions ?? null,
          issuedBy: input.issuedBy,
        })
        .returning({ id: schema.fieldOrder.id });
      await appendEvent(
        tx,
        input.tenantId,
        order.id,
        'ISSUED',
        input.issuedBy,
        {
          message: input.body.instructions ?? null,
          payload: { amountMinor: input.body.amountMinor },
        },
      );
      return order.id;
    });
  }

  /** El cobrador abrió la orden: se registra "vista" solo la primera vez. */
  async markSeen(input: {
    tenantId: string;
    collectorId: string;
    orderId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const order = await loadForUpdate(
        tx,
        input.orderId,
        ownOrder(input.collectorId),
      );
      const next = markSeen(order.status);
      if (!next) return;
      await setStatus(tx, order.id, next);
      await appendEvent(
        tx,
        input.tenantId,
        order.id,
        'SEEN',
        input.collectorId,
      );
    });
  }

  /** El cobrador reporta el depósito con su comprobante (se guarda cifrado antes de la tx). */
  async report(input: {
    tenantId: string;
    collectorId: string;
    orderId: string;
    fields: ReportDepositFields;
    receipt: { bytes: Uint8Array; mimeType: string };
    now: Date;
  }): Promise<void> {
    assertValidReceiptFile({
      mimeType: input.receipt.mimeType,
      sizeBytes: input.receipt.bytes.length,
    });
    const depositedAt = new Date(input.fields.depositedAt);
    // Cada reporte es un objeto propio: tras una objeción, el anterior se conserva como evidencia.
    const storageKey = `deposits/${input.tenantId}/${input.orderId}/${randomUUID()}`;
    const { sha256 } = await this.files.put(
      storageKey,
      input.receipt.bytes,
      input.receipt.mimeType,
    );

    await withTenantTxFor(input.tenantId, async (tx) => {
      const order = await loadForUpdate(
        tx,
        input.orderId,
        ownOrder(input.collectorId),
      );
      const next = reportDeposit(order.status, {
        amountMinor: input.fields.amountMinor,
        depositedAt,
        now: input.now,
      });
      await tx
        .update(schema.fieldOrder)
        .set({
          status: next,
          reportedAmountMinor: input.fields.amountMinor,
          depositedAt,
          depositReference: input.fields.reference ?? null,
          receiptStorageKey: storageKey,
          receiptMimeType: input.receipt.mimeType,
          receiptSha256: sha256,
          reportedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(schema.fieldOrder.id, order.id));
      await appendEvent(
        tx,
        input.tenantId,
        order.id,
        'REPORTED',
        input.collectorId,
        {
          message: input.fields.note ?? null,
          payload: {
            amountMinor: input.fields.amountMinor,
            depositedAt: depositedAt.toISOString(),
            reference: input.fields.reference ?? null,
            receiptStorageKey: storageKey,
          },
        },
      );
    });
  }

  /**
   * El coordinador verifica: TRANSFER ruta → cuenta por lo verificado (el saldo lo valida el
   * dominio) y, si se enlaza el ingreso bancario, queda consumido por la orden. Todo o nada.
   */
  async verify(input: {
    tenantId: string;
    verifiedBy: string;
    orderId: string;
    zoneScope: SQL | undefined;
    body: VerifyDepositInput;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const order = await loadForUpdate(tx, input.orderId, input.zoneScope);
      const next = verifyDeposit(order.status, {
        verifiedAmountMinor: input.body.verifiedAmountMinor,
      });
      if (input.body.bankCreditId) {
        await consumeBankCredit(
          tx,
          order,
          input.body.bankCreditId,
          input.body.verifiedAmountMinor,
        );
      }
      const { transferGroupId } = await postTransferTx(tx, {
        tenantId: input.tenantId,
        fromBoxId: order.routeCashBoxId,
        toBoxId: order.destinationCashBoxId,
        amountMinor: input.body.verifiedAmountMinor,
        reason: DEPOSIT_REASON,
        createdBy: input.verifiedBy,
      });
      const now = new Date();
      await tx
        .update(schema.fieldOrder)
        .set({
          status: next,
          verifiedBy: input.verifiedBy,
          verifiedAt: now,
          verifiedAmountMinor: input.body.verifiedAmountMinor,
          transferGroupId,
          updatedAt: now,
        })
        .where(eq(schema.fieldOrder.id, order.id));
      await appendEvent(
        tx,
        input.tenantId,
        order.id,
        'VERIFIED',
        input.verifiedBy,
        {
          message: input.body.note ?? null,
          payload: {
            verifiedAmountMinor: input.body.verifiedAmountMinor,
            bankCreditId: input.body.bankCreditId ?? null,
          },
        },
      );
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: input.verifiedBy,
        action: 'VERIFY deposit-order',
        entity: AUDIT_ENTITY,
        entityId: order.id,
        payload: {
          verifiedAmountMinor: input.body.verifiedAmountMinor,
          transferGroupId,
        },
      });
    });
  }

  /** Objeción (REPORTED → DISPUTED) o cancelación (antes de verificar), siempre con motivo. */
  async close(input: {
    tenantId: string;
    actorId: string;
    orderId: string;
    zoneScope: SQL | undefined;
    action: 'DISPUTED' | 'CANCELLED';
    reason: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const order = await loadForUpdate(tx, input.orderId, input.zoneScope);
      const next =
        input.action === 'DISPUTED'
          ? disputeDeposit(order.status, input.reason)
          : cancelOrder(order.status, input.reason);
      await setStatus(tx, order.id, next);
      await appendEvent(
        tx,
        input.tenantId,
        order.id,
        input.action,
        input.actorId,
        {
          message: input.reason.trim(),
        },
      );
    });
  }

  /** Comentario en la bitácora (cobrador dueño o revisor del alcance), sin cambiar el estado. */
  async comment(input: {
    tenantId: string;
    actorId: string;
    orderId: string;
    access: SQL | undefined;
    message: string;
  }): Promise<string> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const order = await loadForUpdate(tx, input.orderId, input.access);
      return appendEvent(
        tx,
        input.tenantId,
        order.id,
        'COMMENT',
        input.actorId,
        {
          message: input.message.trim(),
        },
      );
    });
  }
}

/** Solo las órdenes del propio cobrador. */
export function ownOrder(collectorId: string): SQL {
  return eq(schema.fieldOrder.collectorId, collectorId);
}

async function loadForUpdate(
  tx: Tx,
  orderId: string,
  access: SQL | undefined,
): Promise<OrderRow> {
  const [row] = await tx
    .select({ order: schema.fieldOrder })
    .from(schema.fieldOrder)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.fieldOrder.zoneId))
    .where(and(eq(schema.fieldOrder.id, orderId), access))
    .for('update', { of: schema.fieldOrder });
  if (!row) throw new NotFoundException('Orden no encontrada');
  return row.order;
}

async function setStatus(
  tx: Tx,
  orderId: string,
  status: FieldOrderStatus,
): Promise<void> {
  await tx
    .update(schema.fieldOrder)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.fieldOrder.id, orderId));
}

async function appendEvent(
  tx: Tx,
  tenantId: string,
  orderId: string,
  type: EventType,
  actorId: string,
  extra: { message?: string | null; payload?: Record<string, unknown> } = {},
): Promise<string> {
  const [event] = await tx
    .insert(schema.fieldOrderEvent)
    .values({
      tenantId,
      orderId,
      type,
      actorId,
      message: extra.message ?? null,
      payload: extra.payload ?? null,
    })
    .returning({ id: schema.fieldOrderEvent.id });
  return event.id;
}

/** Caja de ruta del cobrador dentro del alcance del coordinador (404 si no la hay o es ajena). */
async function routeBoxInScope(
  tx: Tx,
  collectorId: string,
  currency: string,
  zoneScope: SQL | undefined,
): Promise<{ id: string; zoneId: string | null; zonePath: string | null }> {
  const boxId = await findRouteBox(tx, collectorId, currency);
  if (!boxId) {
    throw new ConflictError(
      'El cobrador no tiene una caja de ruta activa',
      'NO_ROUTE_CASH_BOX',
    );
  }
  const [box] = await tx
    .select({
      id: schema.cashBox.id,
      zoneId: schema.cashBox.zoneId,
      zonePath: schema.zone.path,
    })
    .from(schema.cashBox)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.cashBox.zoneId))
    .where(and(eq(schema.cashBox.id, boxId), zoneScope))
    .limit(1);
  if (!box) throw new NotFoundException('Cobrador no encontrado');
  return { id: box.id, zoneId: box.zoneId, zonePath: box.zonePath ?? null };
}

/** La cuenta destino es una caja BANK activa que la zona del cobrador puede usar. */
async function assertValidDestination(
  tx: Tx,
  routeZonePath: string | null,
  destinationId: string,
): Promise<void> {
  const [destination] = await tx
    .select({
      type: schema.cashBox.type,
      active: schema.cashBox.active,
      zonePath: schema.zone.path,
    })
    .from(schema.cashBox)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.cashBox.zoneId))
    .where(eq(schema.cashBox.id, destinationId))
    .limit(1);
  if (!destination) throw new NotFoundException('Cuenta destino no encontrada');
  if (destination.type !== 'BANK' || !destination.active) {
    throw new ConflictError(
      'La consignación se hace a una cuenta bancaria activa',
      'INVALID_DEPOSIT_DESTINATION',
    );
  }
  if (routeZonePath)
    assertZoneCanUseBox(routeZonePath, destination.zonePath ?? null);
}

/**
 * Enlaza el ingreso bancario al depósito: debe ser de la cuenta destino, por el monto verificado y
 * estar libre (ni de un pago ni de otra orden). Queda consumido por la orden en esta misma tx.
 */
async function consumeBankCredit(
  tx: Tx,
  order: OrderRow,
  bankCreditId: string,
  verifiedAmountMinor: number,
): Promise<void> {
  const [credit] = await tx
    .select({
      id: schema.incomingCredit.id,
      bankAccountId: schema.incomingCredit.bankAccountId,
      amountMinor: schema.incomingCredit.amountMinor,
      consumedByPaymentId: schema.incomingCredit.consumedByPaymentId,
      consumedByFieldOrderId: schema.incomingCredit.consumedByFieldOrderId,
    })
    .from(schema.incomingCredit)
    .where(eq(schema.incomingCredit.id, bankCreditId))
    .for('update');
  if (!credit) throw new NotFoundException('Ingreso bancario no encontrado');
  const [destination] = await tx
    .select({ bankAccountId: schema.cashBox.bankAccountId })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.id, order.destinationCashBoxId))
    .limit(1);
  if (
    credit.consumedByPaymentId !== null ||
    credit.consumedByFieldOrderId !== null
  ) {
    throw new ConflictError(
      'Ese ingreso bancario ya está conciliado',
      'BANK_CREDIT_CONSUMED',
    );
  }
  if (
    credit.bankAccountId !== destination?.bankAccountId ||
    credit.amountMinor !== verifiedAmountMinor
  ) {
    throw new ConflictError(
      'El ingreso bancario no corresponde a la cuenta o al monto verificado',
      'BANK_CREDIT_MISMATCH',
    );
  }
  await tx
    .update(schema.incomingCredit)
    .set({ consumedByFieldOrderId: order.id })
    .where(eq(schema.incomingCredit.id, credit.id));
}
