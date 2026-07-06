import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  OpenChargeSession,
  PaymentChargeSessionStore,
} from '@preztiaos/application';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
} from '../../tenancy/unit-of-work';

/**
 * Persistencia de la SESIÓN/COBRANÇA del cobro conversacional (`payment_charge`), bajo `app` + RLS.
 * `attachCharge` es el punto atómico: crea el COMPROBANTE esperado (pago UNVERIFIED por el monto) y
 * avanza la sesión a PENDING, en una transacción — así la conciliación por settlement confirma el
 * pago cuando llegue el crédito real, respetando el toggle de conciliación automática/manual.
 */
@Injectable()
export class PaymentChargeDrizzleRepository implements PaymentChargeSessionStore {
  async findOpenByChannel(input: {
    channelId: string;
    phone: string;
  }): Promise<OpenChargeSession | null> {
    const tenantId = await resolveTenantByWhatsappPhone(input.channelId);
    if (!tenantId) return null;
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          id: schema.paymentCharge.id,
          creditId: schema.paymentCharge.creditId,
          installmentMinor: schema.paymentCharge.installmentMinor,
          overdueMinor: schema.paymentCharge.overdueMinor,
          currency: schema.paymentCharge.currency,
        })
        .from(schema.paymentCharge)
        .where(
          and(
            eq(schema.paymentCharge.phone, input.phone),
            eq(schema.paymentCharge.status, 'AWAITING_SELECTION'),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        sessionId: row.id,
        tenantId,
        creditId: row.creditId,
        installmentMinor: row.installmentMinor ?? 0,
        overdueMinor: row.overdueMinor ?? 0,
        currency: row.currency,
      };
    });
  }

  async openSession(input: {
    tenantId: string;
    creditId: string;
    phone: string;
    channelId: string;
    provider: 'PICPAY';
    installmentMinor: number;
    overdueMinor: number;
    currency: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      // Una sola sesión abierta por teléfono: se descarta cualquier diálogo previo sin resolver.
      await tx
        .delete(schema.paymentCharge)
        .where(
          and(
            eq(schema.paymentCharge.phone, input.phone),
            eq(schema.paymentCharge.status, 'AWAITING_SELECTION'),
          ),
        );
      await tx.insert(schema.paymentCharge).values({
        tenantId: input.tenantId,
        creditId: input.creditId,
        phone: input.phone,
        channelId: input.channelId,
        provider: input.provider,
        installmentMinor: input.installmentMinor,
        overdueMinor: input.overdueMinor,
        currency: input.currency,
        status: 'AWAITING_SELECTION',
      });
    });
  }

  async attachCharge(input: {
    sessionId: string;
    tenantId: string;
    amountMinor: number;
    merchantChargeId: string;
    copyPaste: string;
    expiresAt: string | null;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      const [session] = await tx
        .select({
          creditId: schema.paymentCharge.creditId,
          phone: schema.paymentCharge.phone,
          channelId: schema.paymentCharge.channelId,
          currency: schema.paymentCharge.currency,
        })
        .from(schema.paymentCharge)
        .where(eq(schema.paymentCharge.id, input.sessionId))
        .limit(1);
      if (!session) return;

      // 1) Comprobante ESPERADO: un pago UNVERIFIED por el monto de la cobrança (sin imagen). La
      //    conciliación por settlement lo confirma/reserva cuando el crédito real llegue por webhook.
      const [claim] = await tx
        .insert(schema.payment)
        .values({
          tenantId: input.tenantId,
          creditId: session.creditId,
          payerPhone: session.phone,
          channelId: session.channelId,
          amountMinor: input.amountMinor,
          currency: session.currency,
          status: 'UNVERIFIED',
          // El merchantChargeId queda como referencia de la cobrança que originó el pago.
          txid: input.merchantChargeId,
        })
        .returning({ id: schema.payment.id });

      await tx.insert(schema.paymentEvent).values({
        tenantId: input.tenantId,
        paymentId: claim.id,
        creditId: session.creditId,
        type: 'payment_charge_created',
        payload: {
          merchantChargeId: input.merchantChargeId,
          amountMinor: input.amountMinor,
        },
      });

      // 2) Avanza la sesión a PENDING con la cobrança generada.
      await tx
        .update(schema.paymentCharge)
        .set({
          status: 'PENDING',
          amountMinor: input.amountMinor,
          merchantChargeId: input.merchantChargeId,
          copyPaste: input.copyPaste,
          paymentId: claim.id,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentCharge.id, input.sessionId));
    });
  }

  async markFailed(input: {
    sessionId: string;
    tenantId: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.paymentCharge)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(schema.paymentCharge.id, input.sessionId));
    });
  }

  /**
   * Refleja en la cobrança el estado reportado por el webhook (PAID/EXPIRED/CANCELED), emparejando
   * por merchantChargeId. Best-effort para trazabilidad de la cobrança; el ABONO al crédito lo hace
   * la conciliación por settlement sobre el comprobante esperado (no este método). Solo avanza desde
   * PENDING para no pisar un estado terminal.
   */
  async markStatusByMerchantChargeId(input: {
    tenantId: string;
    merchantChargeId: string;
    status: 'PAID' | 'EXPIRED' | 'CANCELED';
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, async (tx) => {
      await tx
        .update(schema.paymentCharge)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(
            eq(schema.paymentCharge.merchantChargeId, input.merchantChargeId),
            eq(schema.paymentCharge.status, 'PENDING'),
          ),
        );
    });
  }
}
