import { Injectable } from '@nestjs/common';
import { asc, count, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { type PaymentSummary } from '@preztiaos/contracts';
import {
  portfolioBalanceMinor,
  type InstallmentStatus,
  type PortfolioInstallment,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';

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
        items: rows.map((row: typeof schema.payment.$inferSelect) => ({
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
        })),
        total: Number(totalRow?.value ?? 0),
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

      const installments: PortfolioInstallment[] = rows.map((row: typeof schema.installment.$inferSelect) => ({
        id: row.id,
        seq: row.seq,
        dueDate: row.dueDate,
        amountDueMinor: row.amountDueMinor,
        paidMinor: row.paidMinor,
        status: row.status as InstallmentStatus,
      }));
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

/** Enmascara el CPF/CNPJ dejando solo un fragmento central (PII fuera del API). */
function maskTaxId(taxId: string | null): string | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, '');
  if (digits.length < 5) return '***';
  return `***${digits.slice(3, 9)}**`;
}
