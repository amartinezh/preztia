import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  BankStatusContract,
  PaymentDetail,
  PaymentStatusContract,
  PaymentSummary,
} from '@preztiaos/contracts';
import {
  portfolioBalanceMinor,
  type PortfolioInstallment,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

// Estados que representan un intento NO efectivo (fallido o pendiente) para la auditoría.
const FAILED_STATUSES: PaymentStatusContract[] = [
  'UNVERIFIED',
  'REJECTED_FRAUD',
  'REJECTED_INVALID',
];

/**
 * Read model del slice de pagos: consultas de solo lectura para la API
 * (listados paginados y cartera). No contiene reglas de negocio.
 */
@Injectable()
export class PaymentsQueryRepository {
  async listCreditPayments(input: {
    tenantId: string;
    creditId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: PaymentSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.payment)
        .where(eq(schema.payment.creditId, input.creditId));

      const rows = await tx
        .select()
        .from(schema.payment)
        .where(eq(schema.payment.creditId, input.creditId))
        .orderBy(desc(schema.payment.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        items: rows.map(toSummary),
        total: Number(totalRow?.value ?? 0),
      };
    });
  }

  /** Listado de intentos de pago a nivel tenant (auditoría) con filtros avanzados. */
  async listPaymentAttempts(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    status?: PaymentStatusContract;
    failedOnly?: boolean;
    q?: string;
    bankStatus?: BankStatusContract;
    minAmountMinor?: number;
    maxAmountMinor?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ items: PaymentSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const where = buildAttemptFilters(input);

      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.payment)
        .where(where);

      const rows = await tx
        .select()
        .from(schema.payment)
        .where(where)
        .orderBy(desc(schema.payment.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        items: rows.map(toSummary),
        total: Number(totalRow?.value ?? 0),
      };
    });
  }

  /** Detalle completo de un intento de pago (metadata IA + banco + proceso). Reviewer-only. */
  async getPaymentDetail(input: {
    tenantId: string;
    paymentId: string;
  }): Promise<PaymentDetail | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.payment)
        .where(eq(schema.payment.id, input.paymentId))
        .limit(1);
      if (!row) return null;

      const events = await tx
        .select({
          type: schema.paymentEvent.type,
          payload: schema.paymentEvent.payload,
          createdAt: schema.paymentEvent.createdAt,
        })
        .from(schema.paymentEvent)
        .where(eq(schema.paymentEvent.paymentId, input.paymentId))
        .orderBy(asc(schema.paymentEvent.createdAt));

      // Motivo destacado: los `reasons` del evento de decisión del veredicto (antifraude/banco).
      const flagReasons = extractFlagReasons(events.map((e) => e.payload));

      return {
        id: row.id,
        creditId: row.creditId,
        status: row.status,
        amountMinor: row.amountMinor,
        currency: row.currency,
        paidAt: row.paidAt?.toISOString() ?? null,
        payerPhone: row.payerPhone,
        payerName: row.payerName,
        payerTaxId: row.payerTaxId, // PII completa: el revisor está autorizado en el detalle.
        payerBankName: row.payerBankName,
        receiverPixKey: row.receiverPixKey,
        endToEndId: row.endToEndId,
        txid: row.txid,
        bankStatus: row.bankStatus,
        bankResponse: row.bankResponse ?? null,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        reconciliationAttempts: row.reconciliationAttempts,
        lastReconciliationAt: row.lastReconciliationAt?.toISOString() ?? null,
        extraction:
          (row.extractionRaw as Record<string, unknown> | null) ?? null,
        hasReceipt: row.storageKey != null,
        mimeType: row.mimeType,
        createdAt: row.createdAt.toISOString(),
        flagReasons,
        events: events.map((e) => ({
          type: e.type,
          payload: e.payload ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    });
  }

  async getPortfolio(input: { tenantId: string; creditId: string }) {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [creditRow] = await tx
        .select({ id: schema.credit.id, currency: schema.credit.currency })
        .from(schema.credit)
        .where(eq(schema.credit.id, input.creditId));
      if (!creditRow) return null;

      const rows = await tx
        .select()
        .from(schema.installment)
        .where(eq(schema.installment.creditId, input.creditId))
        .orderBy(asc(schema.installment.seq));

      const installments: PortfolioInstallment[] = rows.map(
        (row: typeof schema.installment.$inferSelect) => ({
          id: row.id,
          seq: row.seq,
          dueDate: row.dueDate,
          amountDueMinor: row.amountDueMinor,
          paidMinor: row.paidMinor,
          status: row.status,
        }),
      );
      return {
        creditId: creditRow.id,
        currency: creditRow.currency,
        balanceMinor: portfolioBalanceMinor(installments),
        installments: installments.map((i) => ({
          seq: i.seq,
          dueDate: i.dueDate,
          amountDueMinor: i.amountDueMinor,
          paidMinor: i.paidMinor,
          status: i.status,
        })),
      };
    });
  }
}

/**
 * Extrae los motivos del veredicto desde los payloads de los eventos del pago: el evento de
 * decisión (antifraude/banco) guarda un arreglo `reasons`. Devuelve el primero encontrado, o null.
 */
function extractFlagReasons(payloads: unknown[]): string[] | null {
  for (const payload of payloads) {
    if (payload && typeof payload === 'object' && 'reasons' in payload) {
      const reasons = payload.reasons;
      if (
        Array.isArray(reasons) &&
        reasons.every((r) => typeof r === 'string') &&
        reasons.length
      ) {
        return reasons;
      }
    }
  }
  return null;
}

/**
 * Construye el `WHERE` de los filtros avanzados de auditoría de pagos. Cada filtro es
 * opcional e independiente; se combinan con AND. La búsqueda de texto (`q`) abarca pagador,
 * CPF/CNPJ, banco emisor y end-to-end id (el revisor está autorizado a ver la PII completa).
 */
function buildAttemptFilters(input: {
  status?: PaymentStatusContract;
  failedOnly?: boolean;
  q?: string;
  bankStatus?: BankStatusContract;
  minAmountMinor?: number;
  maxAmountMinor?: number;
  fromDate?: string;
  toDate?: string;
}): SQL | undefined {
  const filters: SQL[] = [];

  if (input.status) {
    filters.push(eq(schema.payment.status, input.status));
  } else if (input.failedOnly) {
    filters.push(inArray(schema.payment.status, FAILED_STATUSES));
  }

  if (input.bankStatus) {
    filters.push(eq(schema.payment.bankStatus, input.bankStatus));
  }

  if (input.q) {
    const like = `%${input.q}%`;
    const text = or(
      ilike(schema.payment.payerName, like),
      ilike(schema.payment.payerTaxId, like),
      ilike(schema.payment.payerBankName, like),
      ilike(schema.payment.endToEndId, like),
    );
    if (text) filters.push(text);
  }

  if (input.minAmountMinor !== undefined) {
    filters.push(gte(schema.payment.amountMinor, input.minAmountMinor));
  }
  if (input.maxAmountMinor !== undefined) {
    filters.push(lte(schema.payment.amountMinor, input.maxAmountMinor));
  }

  // Rango de la fecha de pago: [fromDate 00:00, toDate 23:59:59.999] inclusivo.
  if (input.fromDate) {
    filters.push(gte(schema.payment.paidAt, new Date(`${input.fromDate}T00:00:00.000Z`)));
  }
  if (input.toDate) {
    filters.push(lte(schema.payment.paidAt, new Date(`${input.toDate}T23:59:59.999Z`)));
  }

  return filters.length ? and(...filters) : undefined;
}

/** Mapea una fila de pago al resumen del contrato (CPF/CNPJ enmascarado: PII fuera del API). */
function toSummary(row: typeof schema.payment.$inferSelect): PaymentSummary {
  return {
    id: row.id,
    status: row.status,
    amountMinor: row.amountMinor,
    currency: row.currency,
    paidAt: row.paidAt?.toISOString() ?? null,
    payerName: row.payerName,
    payerTaxIdMasked: maskTaxId(row.payerTaxId),
    payerBankName: row.payerBankName,
    endToEndId: row.endToEndId,
    bankStatus: row.bankStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Enmascara el CPF/CNPJ dejando solo un fragmento central (PII fuera del API). */
function maskTaxId(taxId: string | null): string | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, '');
  if (digits.length < 5) return '***';
  return `***${digits.slice(3, 9)}**`;
}
