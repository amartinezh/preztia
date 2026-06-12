import {
  allocatePayment,
  decideReconciliation,
  Money,
  portfolioBalanceMinor,
  type AllocationResult,
  type PixReceiptData,
} from "@preztiaos/domain";
import type { OutboundTextSender } from "../../conversations/text/ports";
import { formatAmount } from "./format-amount";
import type {
  ActiveCreditPortfolio,
  BankPaymentVerifier,
  BankVerificationResult,
  PaymentAuditEvent,
  TenantBankAccountRepository,
} from "./ports";

/** Pago UNVERIFIED pendiente de conciliación, con lo necesario para reconsultarlo. */
export interface PendingPayment {
  readonly id: string;
  readonly creditId: string | null;
  readonly channelId: string | null;
  readonly payerPhone: string;
  readonly pix: PixReceiptData;
  readonly reconciliationAttempts: number;
}

/**
 * Puerto: persistencia de la conciliación. `applyVerification` ejecuta UNA
 * transacción (pago → VERIFIED + abonos + cuotas + crédito SETTLED si aplica +
 * eventos append-only), idempotente: un pago ya verificado no se re-abona.
 */
export interface ReconciliationRepository {
  /** Pagos UNVERIFIED del tenant, paginados por cursor (obligatorio: sin listas abiertas). */
  listUnverified(input: {
    tenantId: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: readonly PendingPayment[]; nextCursor: string | null }>;
  loadPortfolio(input: { tenantId: string; creditId: string }): Promise<ActiveCreditPortfolio | null>;
  applyVerification(input: {
    tenantId: string;
    paymentId: string;
    bankResult: BankVerificationResult;
    allocation: AllocationResult;
    events: readonly PaymentAuditEvent[];
  }): Promise<void>;
  /** Deja el pago pendiente; cuenta el intento solo si el banco respondió not_found. */
  keepPending(input: { tenantId: string; paymentId: string; countAttempt: boolean }): Promise<void>;
  flagSuspectedFraud(input: {
    tenantId: string;
    paymentId: string;
    reasons: readonly string[];
  }): Promise<void>;
}

export interface ReconciliationSummary {
  readonly processed: number;
  readonly verified: number;
  readonly stillPending: number;
  readonly flagged: number;
}

const PAGE_SIZE = 50;

/**
 * Caso de uso (batch): revalida contra el banco los pagos que quedaron UNVERIFIED.
 * Confirmado → verifica, abona cuotas y notifica al cliente; sin señal → siguiente
 * ciclo; no encontrado tras agotar intentos → sospecha de fraude para el analista.
 *
 * Invocable hoy por endpoint; listo para un cron/cola futura sin cambios.
 */
export class ReconcilePendingPaymentsHandler {
  constructor(
    private readonly payments: ReconciliationRepository,
    private readonly bankAccounts: TenantBankAccountRepository,
    private readonly bank: BankPaymentVerifier,
    private readonly sender: OutboundTextSender,
    private readonly maxAttempts: number,
  ) {}

  async execute(cmd: { tenantId: string }): Promise<ReconciliationSummary> {
    const account = await this.bankAccounts.findActive(cmd.tenantId);
    let processed = 0;
    let verified = 0;
    let stillPending = 0;
    let flagged = 0;

    if (!account) return { processed, verified, stillPending, flagged };

    let cursor: string | undefined;
    do {
      const page = await this.payments.listUnverified({
        tenantId: cmd.tenantId,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      for (const payment of page.items) {
        processed++;
        const outcome = await this.reconcileOne(cmd.tenantId, account.countryCode, account.bankCode, payment);
        if (outcome === "verified") verified++;
        else if (outcome === "flagged") flagged++;
        else stillPending++;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    return { processed, verified, stillPending, flagged };
  }

  private async reconcileOne(
    tenantId: string,
    countryCode: string,
    bankCode: string,
    payment: PendingPayment,
  ): Promise<"verified" | "pending" | "flagged"> {
    const bankResult = await this.bank.verify({ tenantId, countryCode, bankCode, pix: payment.pix });
    const decision = decideReconciliation({
      bank: bankResult.verification,
      attempts: payment.reconciliationAttempts,
      maxAttempts: this.maxAttempts,
    });

    if (decision.kind === "flag_suspected_fraud") {
      await this.payments.flagSuspectedFraud({ tenantId, paymentId: payment.id, reasons: decision.reasons });
      return "flagged";
    }

    if (decision.kind === "keep_pending") {
      await this.payments.keepPending({
        tenantId,
        paymentId: payment.id,
        countAttempt: bankResult.verification.status === "not_found",
      });
      return "pending";
    }

    // verify_and_allocate: sin crédito asociado no hay cartera que abonar todavía.
    const portfolio = payment.creditId
      ? await this.payments.loadPortfolio({ tenantId, creditId: payment.creditId })
      : null;
    if (!portfolio) {
      await this.payments.keepPending({ tenantId, paymentId: payment.id, countAttempt: false });
      return "pending";
    }

    const allocation = allocatePayment(
      portfolio.currency,
      portfolio.installments,
      Money.of(decision.amountMinor, portfolio.currency),
    );
    const events: PaymentAuditEvent[] = [
      { type: "payment_verified_by_reconciliation", payload: { creditId: portfolio.creditId } },
      {
        type: "payment_allocated",
        payload: {
          creditId: portfolio.creditId,
          allocations: allocation.allocations.map((a) => ({ ...a })),
        },
      },
    ];
    if (allocation.creditSettled) {
      events.push({ type: "credit_settled", payload: { creditId: portfolio.creditId } });
    }
    await this.payments.applyVerification({
      tenantId,
      paymentId: payment.id,
      bankResult,
      allocation,
      events,
    });

    if (payment.channelId) {
      const remaining = portfolioBalanceMinor(allocation.installments);
      const body = allocation.creditSettled
        ? "✅ Tu pago fue confirmado por el banco. 🎉 ¡Tu crédito quedó *saldado*!"
        : `✅ Tu pago fue confirmado por el banco. Saldo pendiente: ${formatAmount(remaining, portfolio.currency)}.`;
      await this.sender.sendText({ channelId: payment.channelId, recipient: payment.payerPhone }, body);
    }
    return "verified";
  }
}
