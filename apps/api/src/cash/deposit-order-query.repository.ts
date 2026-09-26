import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { schema } from '@preztiaos/db';
import { rankDepositMatches, type FieldOrderStatus } from '@preztiaos/domain';
import type { DepositOrder, FieldOrderEvent } from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { EncryptedFileBucket } from '../shared/encrypted-file-bucket';

const MAX_BANK_MATCHES = 10;
const destinationBox = alias(schema.cashBox, 'destination_box');

/**
 * Lecturas de las ÓRDENES DE CONSIGNACIÓN, siempre acotadas por `access` (el cobrador solo lo suyo;
 * el coordinador su subárbol; el ADMIN todo). Sin N+1: cada listado es una consulta con sus joins.
 */
@Injectable()
export class DepositOrderQueryRepository {
  private readonly files = new EncryptedFileBucket();

  async list(input: {
    tenantId: string;
    currency: string;
    access: SQL | undefined;
    status?: FieldOrderStatus;
    collectorId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: DepositOrder[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = and(
        input.access,
        input.status ? eq(schema.fieldOrder.status, input.status) : undefined,
        input.collectorId
          ? eq(schema.fieldOrder.collectorId, input.collectorId)
          : undefined,
      );
      const rows = await selectOrders(tx)
        .where(where)
        .orderBy(desc(schema.fieldOrder.issuedAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await tx
        .select({ value: count() })
        .from(schema.fieldOrder)
        .leftJoin(schema.zone, eq(schema.zone.id, schema.fieldOrder.zoneId))
        .where(where);
      return {
        items: rows.map((r) => toView(r, input.currency)),
        total: Number(total?.value ?? 0),
      };
    });
  }

  async get(input: {
    tenantId: string;
    currency: string;
    orderId: string;
    access: SQL | undefined;
  }): Promise<DepositOrder> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await selectOrders(tx)
        .where(and(eq(schema.fieldOrder.id, input.orderId), input.access))
        .limit(1);
      if (!row) throw new NotFoundException('Orden no encontrada');
      return toView(row, input.currency);
    });
  }

  /** Bitácora completa, en orden cronológico, con el email del actor. */
  async events(input: {
    tenantId: string;
    orderId: string;
    access: SQL | undefined;
  }): Promise<FieldOrderEvent[]> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      await assertVisible(tx, input.orderId, input.access);
      const rows = await tx
        .select({
          event: schema.fieldOrderEvent,
          actorEmail: schema.appUser.email,
        })
        .from(schema.fieldOrderEvent)
        .leftJoin(
          schema.appUser,
          eq(schema.appUser.id, schema.fieldOrderEvent.actorId),
        )
        .where(eq(schema.fieldOrderEvent.orderId, input.orderId))
        .orderBy(asc(schema.fieldOrderEvent.createdAt));
      return rows.map(({ event, actorEmail }) => ({
        id: event.id,
        type: event.type,
        actorId: event.actorId,
        actorEmail: actorEmail ?? null,
        message: event.message,
        payload: (event.payload as Record<string, unknown> | null) ?? null,
        createdAt: event.createdAt.toISOString(),
      }));
    });
  }

  /**
   * Ingresos LIBRES de la cuenta destino que pueden ser el depósito reportado: monto exacto y cerca
   * de la hora reportada (regla del dominio `rankDepositMatches`). Solo sugerencias.
   */
  async bankMatches(input: {
    tenantId: string;
    orderId: string;
    access: SQL | undefined;
  }): Promise<
    {
      id: string;
      amountMinor: number;
      receivedAt: string;
      endToEndId: string | null;
    }[]
  > {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [order] = await tx
        .select({
          reportedAmountMinor: schema.fieldOrder.reportedAmountMinor,
          depositedAt: schema.fieldOrder.depositedAt,
          bankAccountId: destinationBox.bankAccountId,
        })
        .from(schema.fieldOrder)
        .leftJoin(schema.zone, eq(schema.zone.id, schema.fieldOrder.zoneId))
        .innerJoin(
          destinationBox,
          eq(destinationBox.id, schema.fieldOrder.destinationCashBoxId),
        )
        .where(and(eq(schema.fieldOrder.id, input.orderId), input.access))
        .limit(1);
      if (!order) throw new NotFoundException('Orden no encontrada');
      if (
        !order.reportedAmountMinor ||
        !order.depositedAt ||
        !order.bankAccountId
      )
        return [];

      const free = await tx
        .select({
          id: schema.incomingCredit.id,
          amountMinor: schema.incomingCredit.amountMinor,
          receivedAt: schema.incomingCredit.settlementDate,
          endToEndId: schema.incomingCredit.endToEndId,
        })
        .from(schema.incomingCredit)
        .where(
          and(
            eq(schema.incomingCredit.bankAccountId, order.bankAccountId),
            eq(schema.incomingCredit.amountMinor, order.reportedAmountMinor),
            isNull(schema.incomingCredit.consumedByPaymentId),
            isNull(schema.incomingCredit.consumedByFieldOrderId),
          ),
        );
      return rankDepositMatches(
        {
          amountMinor: order.reportedAmountMinor,
          depositedAt: order.depositedAt,
        },
        free,
      )
        .slice(0, MAX_BANK_MATCHES)
        .map((c) => ({ ...c, receivedAt: c.receivedAt.toISOString() }));
    });
  }

  /** Comprobante vigente descifrado (el último reporte). */
  async receipt(input: {
    tenantId: string;
    orderId: string;
    access: SQL | undefined;
  }): Promise<{ bytes: Buffer; mimeType: string }> {
    const [row] = await withTenantTxFor(input.tenantId, async (tx) =>
      tx
        .select({
          storageKey: schema.fieldOrder.receiptStorageKey,
          mimeType: schema.fieldOrder.receiptMimeType,
        })
        .from(schema.fieldOrder)
        .leftJoin(schema.zone, eq(schema.zone.id, schema.fieldOrder.zoneId))
        .where(and(eq(schema.fieldOrder.id, input.orderId), input.access))
        .limit(1),
    );
    if (!row?.storageKey)
      throw new NotFoundException('La orden no tiene comprobante');
    return {
      bytes: await this.files.get(row.storageKey),
      mimeType: row.mimeType ?? 'application/octet-stream',
    };
  }
}

function selectOrders(tx: Tx) {
  return tx
    .select({
      order: schema.fieldOrder,
      collectorEmail: schema.appUser.email,
      zoneName: schema.zone.name,
      destinationName: destinationBox.name,
      bankCreditId: schema.incomingCredit.id,
    })
    .from(schema.fieldOrder)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.fieldOrder.zoneId))
    .leftJoin(
      schema.appUser,
      eq(schema.appUser.id, schema.fieldOrder.collectorId),
    )
    .innerJoin(
      destinationBox,
      eq(destinationBox.id, schema.fieldOrder.destinationCashBoxId),
    )
    .leftJoin(
      schema.incomingCredit,
      eq(schema.incomingCredit.consumedByFieldOrderId, schema.fieldOrder.id),
    )
    .$dynamic();
}

type OrderSelection = Awaited<
  ReturnType<ReturnType<typeof selectOrders>['execute']>
>[number];

function toView(r: OrderSelection, currency: string): DepositOrder {
  const o = r.order;
  return {
    id: o.id,
    status: o.status,
    collectorId: o.collectorId,
    collectorEmail: r.collectorEmail ?? null,
    zoneId: o.zoneId,
    zoneName: r.zoneName ?? null,
    routeCashBoxId: o.routeCashBoxId,
    destinationCashBoxId: o.destinationCashBoxId,
    destinationName: r.destinationName,
    amountMinor: o.amountMinor,
    instructions: o.instructions,
    issuedBy: o.issuedBy,
    issuedAt: o.issuedAt.toISOString(),
    reportedAmountMinor: o.reportedAmountMinor,
    depositedAt: o.depositedAt?.toISOString() ?? null,
    depositReference: o.depositReference,
    hasReceipt: o.receiptStorageKey !== null,
    reportedAt: o.reportedAt?.toISOString() ?? null,
    verifiedBy: o.verifiedBy,
    verifiedAt: o.verifiedAt?.toISOString() ?? null,
    verifiedAmountMinor: o.verifiedAmountMinor,
    bankCreditId: r.bankCreditId ?? null,
    currency,
  };
}

async function assertVisible(
  tx: Tx,
  orderId: string,
  access: SQL | undefined,
): Promise<void> {
  const [row] = await tx
    .select({ id: schema.fieldOrder.id })
    .from(schema.fieldOrder)
    .leftJoin(schema.zone, eq(schema.zone.id, schema.fieldOrder.zoneId))
    .where(and(eq(schema.fieldOrder.id, orderId), access))
    .limit(1);
  if (!row) throw new NotFoundException('Orden no encontrada');
}
