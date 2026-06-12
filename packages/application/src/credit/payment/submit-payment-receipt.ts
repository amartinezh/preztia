import {
  allocatePayment,
  Money,
  portfolioBalanceMinor,
  type AllocationResult,
  type BankVerification,
  type MediaClassification,
  type PaymentReviewDecision,
  type PixReceiptData,
} from "@preztiaos/domain";
import { decidePaymentReview } from "@preztiaos/domain";
import type { OutboundTextSender } from "../../conversations/text/ports";
import type { DownloadedMedia } from "../application/ports";
import { formatAmount } from "./format-amount";
import type {
  ActiveCreditPortfolio,
  BankPaymentVerifier,
  BankVerificationResult,
  CreditPortfolioRepository,
  PaymentAntifraudService,
  PaymentAuditEvent,
  PaymentOutcome,
  PaymentReceiptStorage,
  PaymentRecord,
  TenantBankAccountRepository,
} from "./ports";

/** Comprobante entrante ya preparado por el enrutador de media (descargado y clasificado). */
export interface SubmitPaymentReceiptCommand {
  readonly tenantId: string;
  readonly channelId: string;
  /** teléfono del pagador (E.164 sin '+'). */
  readonly payerPhone: string;
  readonly messageId: string;
  readonly mediaId: string;
  readonly media: DownloadedMedia;
  readonly classification: MediaClassification;
}

/**
 * Caso de uso: recibe un comprobante de pago (PIX), lo somete a antifraude y a la
 * verificación bancaria, decide con la regla pura del dominio y, si procede, abona
 * las cuotas de la cartera en cascada. Todo queda persistido en una transacción
 * (pago + asignaciones + cuotas + eventos append-only) y el cliente recibe la
 * respuesta por WhatsApp.
 *
 * No conoce WhatsApp, IA, bancos ni BD: solo coordina dominio + puertos.
 */
export class SubmitPaymentReceiptHandler {
  constructor(
    private readonly portfolios: CreditPortfolioRepository,
    private readonly bankAccounts: TenantBankAccountRepository,
    private readonly antifraud: PaymentAntifraudService,
    private readonly bank: BankPaymentVerifier,
    private readonly storage: PaymentReceiptStorage,
    private readonly sender: OutboundTextSender,
  ) {}

  async execute(cmd: SubmitPaymentReceiptCommand): Promise<void> {
    const recipient = { channelId: cmd.channelId, recipient: cmd.payerPhone };
    const pix = cmd.classification.kind === "payment_receipt" ? cmd.classification.pix : null;

    // 1) Sin crédito activo no hay cartera que abonar: se registra el comprobante
    //    como huérfano (evidencia auditable) y se orienta al cliente.
    const portfolio = await this.portfolios.findActiveByPhone({
      tenantId: cmd.tenantId,
      phone: cmd.payerPhone,
    });
    if (!portfolio) {
      await this.saveOrphan(cmd, pix);
      await this.sender.sendText(
        recipient,
        "No encontramos un crédito activo asociado a este número. Guardamos tu comprobante y un asesor lo revisará.",
      );
      return;
    }

    // 2) El archivo no es un comprobante: se orienta sin registrar pago.
    if (cmd.classification.kind !== "payment_receipt" || !pix) {
      await this.sender.sendText(
        recipient,
        "El archivo que enviaste no parece un comprobante de pago. Si realizaste un pago, envíame la foto o el PDF del comprobante PIX.",
      );
      return;
    }

    // 3) Antifraude estructural + verificación bancaria en línea.
    const structural = await this.antifraud.assess({
      tenantId: cmd.tenantId,
      sha256: cmd.media.sha256,
      pix,
      receivedAt: new Date().toISOString(),
      payerPhone: cmd.payerPhone,
    });
    const account = await this.bankAccounts.findActive(cmd.tenantId);
    const bankResult: BankVerificationResult = account
      ? await this.bank.verify({
          tenantId: cmd.tenantId,
          countryCode: account.countryCode,
          bankCode: account.bankCode,
          pix,
        })
      : { verification: { status: "unavailable", reason: "sin_cuenta_bancaria_configurada" } };

    // 4) Decisión pura del dominio.
    const decision = decidePaymentReview({ structural, pix, bank: bankResult.verification });

    // 5) El comprobante SIEMPRE se guarda: es evidencia (también en rechazos).
    const stored = await this.storage.store({
      tenantId: cmd.tenantId,
      creditId: portfolio.creditId,
      media: cmd.media,
    });

    const allocate =
      decision.kind === "accepted_verified" ||
      (decision.kind === "accepted_unverified" && account?.unverifiedPolicy === "ALLOCATE");
    const allocation = allocate
      ? allocatePayment(
          portfolio.currency,
          portfolio.installments,
          Money.of(amountOf(decision), portfolio.currency),
        )
      : null;

    await this.portfolios.savePaymentOutcome(
      buildOutcome(cmd, portfolio, pix, decision, bankResult, stored.storageKey, allocation),
    );

    // 6) Respuesta al cliente según la decisión.
    await this.sender.sendText(
      recipient,
      responseMessage(decision, portfolio, allocation),
    );
  }

  /** Registra un comprobante sin crédito activo (estado RECEIVED, sin abonos). */
  private async saveOrphan(cmd: SubmitPaymentReceiptCommand, pix: PixReceiptData | null): Promise<void> {
    const stored = await this.storage.store({ tenantId: cmd.tenantId, creditId: null, media: cmd.media });
    await this.portfolios.savePaymentOutcome({
      payment: paymentRecord(cmd, null, pix, "RECEIVED", null, null, stored.storageKey, null),
      allocations: [],
      installments: [],
      creditSettled: false,
      events: [{ type: "payment_received_orphan", payload: { payerPhone: cmd.payerPhone } }],
    });
  }
}

/** Monto a abonar según la decisión (el del banco si está verificado). */
function amountOf(
  decision: Extract<PaymentReviewDecision, { kind: "accepted_verified" | "accepted_unverified" }>,
): number {
  return decision.amountMinor;
}

function buildOutcome(
  cmd: SubmitPaymentReceiptCommand,
  portfolio: ActiveCreditPortfolio,
  pix: PixReceiptData,
  decision: PaymentReviewDecision,
  bankResult: BankVerificationResult,
  storageKey: string,
  allocation: AllocationResult | null,
): PaymentOutcome {
  const status =
    decision.kind === "accepted_verified"
      ? "VERIFIED"
      : decision.kind === "accepted_unverified"
        ? "UNVERIFIED"
        : decision.kind === "rejected_fraud"
          ? "REJECTED_FRAUD"
          : "REJECTED_INVALID";

  const assessment =
    decision.kind === "accepted_verified"
      ? decision.assessment
      : decision.kind === "rejected_fraud"
        ? { score: 100, reasons: decision.reasons }
        : null;

  const events: PaymentAuditEvent[] = [
    { type: `payment_${status.toLowerCase()}`, payload: { creditId: portfolio.creditId } },
  ];
  if (allocation) {
    events.push({
      type: "payment_allocated",
      payload: {
        creditId: portfolio.creditId,
        allocations: allocation.allocations.map((a) => ({ ...a })),
      },
    });
    if (allocation.overpaymentMinor > 0) {
      events.push({
        type: "overpayment_registered",
        payload: { creditId: portfolio.creditId, overpaymentMinor: allocation.overpaymentMinor },
      });
    }
    if (allocation.creditSettled) {
      events.push({ type: "credit_settled", payload: { creditId: portfolio.creditId } });
    }
  }

  return {
    payment: paymentRecord(
      cmd,
      portfolio.creditId,
      pix,
      status,
      bankStatusOf(bankResult.verification),
      bankResult.rawResponse ?? null,
      storageKey,
      assessment,
    ),
    allocations: allocation?.allocations ?? [],
    // Solo se persisten las cuotas que recibieron abono.
    installments:
      allocation?.installments.filter((i) =>
        allocation.allocations.some((a) => a.installmentId === i.id),
      ) ?? [],
    creditSettled: allocation?.creditSettled ?? false,
    events,
  };
}

function paymentRecord(
  cmd: SubmitPaymentReceiptCommand,
  creditId: string | null,
  pix: PixReceiptData | null,
  status: PaymentRecord["status"],
  bankStatus: PaymentRecord["bankStatus"],
  bankResponse: unknown,
  storageKey: string | null,
  assessment: { score: number; reasons: readonly string[] } | null,
): PaymentRecord {
  return {
    tenantId: cmd.tenantId,
    creditId,
    providerMessageId: cmd.messageId,
    channelId: cmd.channelId,
    payerPhone: cmd.payerPhone,
    amountMinor: pix?.amountMinor ?? null,
    currency: pix?.currency ?? "BRL",
    paidAt: pix?.paidAt ?? null,
    payerName: pix?.payerName ?? null,
    payerTaxId: pix?.payerTaxId ?? null,
    payerBankName: pix?.payerBankName ?? null,
    receiverPixKey: pix?.receiverPixKey ?? null,
    endToEndId: pix?.endToEndId ?? null,
    txid: pix?.txid ?? null,
    extractionRaw: pix?.raw ?? null,
    sha256: cmd.media.sha256,
    storageKey,
    mimeType: cmd.media.mimeType,
    status,
    bankStatus,
    bankResponse,
    fraudScore: assessment?.score ?? null,
    fraudReasons: assessment ? [...assessment.reasons] : null,
  };
}

function bankStatusOf(verification: BankVerification): PaymentRecord["bankStatus"] {
  if (verification.status === "confirmed") return "CONFIRMED";
  if (verification.status === "not_found") return "NOT_FOUND";
  return "UNAVAILABLE";
}

/** Mensaje al cliente según la decisión; nunca expone detalles que eduquen al defraudador. */
function responseMessage(
  decision: PaymentReviewDecision,
  portfolio: ActiveCreditPortfolio,
  allocation: AllocationResult | null,
): string {
  switch (decision.kind) {
    case "accepted_verified":
    case "accepted_unverified": {
      if (!allocation) {
        return "Recibimos tu comprobante y está *en verificación* con el banco. Te confirmaremos el abono apenas se valide.";
      }
      const paid = formatAmount(decision.amountMinor, portfolio.currency);
      if (allocation.creditSettled) {
        const credit =
          allocation.overpaymentMinor > 0
            ? ` Quedó un saldo a tu favor de ${formatAmount(allocation.overpaymentMinor, portfolio.currency)}.`
            : "";
        return `✅ Recibimos tu pago de ${paid}. 🎉 ¡Tu crédito quedó *saldado*!${credit}`;
      }
      const remaining = portfolioBalanceMinor(allocation.installments);
      const count = allocation.allocations.length;
      return (
        `✅ Recibimos tu pago de ${paid} y abonamos ${count} cuota${count === 1 ? "" : "s"}. ` +
        `Saldo pendiente: ${formatAmount(remaining, portfolio.currency)}.`
      );
    }
    case "rejected_invalid":
      return "No pudimos leer el monto del comprobante. Por favor envía una foto o PDF más legible del comprobante PIX.";
    case "rejected_fraud":
      return "No pudimos validar este comprobante. Un analista lo revisará y te contactaremos.";
  }
}
