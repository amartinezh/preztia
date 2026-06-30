import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type NormalizedCredit } from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

/**
 * Persistencia de los CRÉDITOS de la fuente de liquidación (ground truth de la Fase 2).
 *
 * - `ingestMany`: idempotente por (tenant, source_id) — reingestar el mismo reporte no duplica
 *   créditos ni reabre los ya consumidos (I4).
 * - `listUnconsumed`: créditos aún disponibles para el match (consumed_by_payment_id IS NULL).
 * - `markConsumed`: marca un crédito como consumido SOLO si seguía libre (consumo atómico → un
 *   crédito valida un único pago, I1). Todo bajo RLS por tenant.
 */
/** Cuenta recaudadora MERCADOPAGO activa del tenant (para traer e ingerir su reporte). */
export interface SettlementAccount {
  readonly bankAccountId: string;
  readonly countryCode: string;
  readonly bankCode: string;
  readonly windowDays: number | null;
}

@Injectable()
export class IncomingCreditDrizzleRepository {
  /** Resuelve la cuenta MERCADOPAGO activa del tenant; null si no hay ninguna. */
  async findSettlementAccount(
    tenantId: string,
  ): Promise<SettlementAccount | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          bankAccountId: schema.tenantBankAccount.id,
          countryCode: schema.tenantBankAccount.countryCode,
          bankCode: schema.tenantBankAccount.bankCode,
          reportConfig: schema.tenantBankAccount.reportConfig,
        })
        .from(schema.tenantBankAccount)
        .where(
          and(
            eq(schema.tenantBankAccount.providerType, 'MERCADOPAGO'),
            eq(schema.tenantBankAccount.active, true),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        bankAccountId: row.bankAccountId,
        countryCode: row.countryCode,
        bankCode: row.bankCode,
        windowDays: row.reportConfig?.windowDays ?? null,
      };
    });
  }

  /** Ingiere filas del reporte; ignora las ya presentes (idempotente). Devuelve cuántas creó. */
  async ingestMany(input: {
    tenantId: string;
    bankAccountId: string;
    credits: readonly NormalizedCredit[];
  }): Promise<{ ingested: number }> {
    if (input.credits.length === 0) return { ingested: 0 };
    return withTenantTxFor(input.tenantId, async (tx) => {
      const inserted = await tx
        .insert(schema.incomingCredit)
        .values(
          input.credits.map((credit) => ({
            tenantId: input.tenantId,
            bankAccountId: input.bankAccountId,
            sourceId: credit.sourceId,
            amountMinor: credit.amountMinor,
            netAmountMinor: credit.netAmountMinor,
            currency: credit.currency,
            paymentMethodType: credit.paymentMethodType,
            transactionType: credit.transactionType,
            settlementDate: new Date(credit.settlementDate),
          })),
        )
        .onConflictDoNothing({
          target: [
            schema.incomingCredit.tenantId,
            schema.incomingCredit.sourceId,
          ],
        })
        .returning({ id: schema.incomingCredit.id });
      return { ingested: inserted.length };
    });
  }

  /** Créditos aún no consumidos de una cuenta, normalizados para el matcher de dominio. */
  async listUnconsumed(input: {
    tenantId: string;
    bankAccountId: string;
  }): Promise<NormalizedCredit[]> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select({
          sourceId: schema.incomingCredit.sourceId,
          amountMinor: schema.incomingCredit.amountMinor,
          netAmountMinor: schema.incomingCredit.netAmountMinor,
          currency: schema.incomingCredit.currency,
          paymentMethodType: schema.incomingCredit.paymentMethodType,
          transactionType: schema.incomingCredit.transactionType,
          settlementDate: schema.incomingCredit.settlementDate,
        })
        .from(schema.incomingCredit)
        .where(
          and(
            eq(schema.incomingCredit.bankAccountId, input.bankAccountId),
            isNull(schema.incomingCredit.consumedByPaymentId),
          ),
        );
      return rows.map((row) => ({
        sourceId: row.sourceId,
        amountMinor: row.amountMinor,
        netAmountMinor: row.netAmountMinor,
        currency: row.currency,
        paymentMethodType: row.paymentMethodType,
        transactionType: row.transactionType,
        settlementDate: row.settlementDate.toISOString(),
      }));
    });
  }

  /**
   * Marca un crédito como consumido por un pago, solo si seguía libre. Devuelve `true` si lo
   * tomó (consumo atómico: dos intentos concurrentes, uno solo gana → no doble consumo).
   */
  async markConsumed(input: {
    tenantId: string;
    sourceId: string;
    paymentId: string;
  }): Promise<boolean> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const updated = await tx
        .update(schema.incomingCredit)
        .set({ consumedByPaymentId: input.paymentId })
        .where(
          and(
            eq(schema.incomingCredit.sourceId, input.sourceId),
            isNull(schema.incomingCredit.consumedByPaymentId),
          ),
        )
        .returning({ id: schema.incomingCredit.id });
      return updated.length > 0;
    });
  }
}
