import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
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
/** Cuenta recaudadora con fuente de liquidación (MP: reporte; PicPay: webhooks). */
export interface SettlementAccount {
  readonly bankAccountId: string;
  readonly countryCode: string;
  readonly bankCode: string;
  readonly windowDays: number | null;
}

// Proveedores cuyo ground truth vive en `incoming_credit` (reporte batch o webhook PAID).
const SETTLEMENT_PROVIDERS = ['MERCADOPAGO', 'PICPAY'] as const;

@Injectable()
export class IncomingCreditDrizzleRepository {
  /**
   * Cuentas activas del tenant con fuente de liquidación y la VALIDACIÓN DE PAGOS habilitada
   * (toggle por cuenta): son las que participan en la conciliación de la Fase 2.
   */
  async listSettlementAccounts(tenantId: string): Promise<SettlementAccount[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select({
          bankAccountId: schema.tenantBankAccount.id,
          countryCode: schema.tenantBankAccount.countryCode,
          bankCode: schema.tenantBankAccount.bankCode,
          reportConfig: schema.tenantBankAccount.reportConfig,
        })
        .from(schema.tenantBankAccount)
        .where(
          and(
            inArray(schema.tenantBankAccount.providerType, [
              ...SETTLEMENT_PROVIDERS,
            ]),
            eq(schema.tenantBankAccount.active, true),
            eq(schema.tenantBankAccount.verifyPaymentsEnabled, true),
          ),
        );
      return rows.map((row) => ({
        bankAccountId: row.bankAccountId,
        countryCode: row.countryCode,
        bankCode: row.bankCode,
        windowDays: row.reportConfig?.windowDays ?? null,
      }));
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
            endToEndId: credit.endToEndId ?? null,
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
          endToEndId: schema.incomingCredit.endToEndId,
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
        endToEndId: row.endToEndId,
      }));
    });
  }

  /**
   * De un conjunto de pagos, cuáles YA tienen un crédito ligado (consumed_by_payment_id). En
   * pagos UNVERIFIED esto significa "crédito reservado, pendiente de aprobación": permite al
   * ciclo de conciliación NO volver a reservarles otro crédito (una reserva por pago).
   */
  async paymentsWithReservedCredit(input: {
    tenantId: string;
    paymentIds: readonly string[];
  }): Promise<Set<string>> {
    if (input.paymentIds.length === 0) return new Set();
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select({ paymentId: schema.incomingCredit.consumedByPaymentId })
        .from(schema.incomingCredit)
        .where(
          inArray(schema.incomingCredit.consumedByPaymentId, [
            ...input.paymentIds,
          ]),
        );
      return new Set(
        rows.map((r) => r.paymentId).filter((id): id is string => id !== null),
      );
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
