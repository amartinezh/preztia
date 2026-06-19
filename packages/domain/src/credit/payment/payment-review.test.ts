import { describe, it, expect } from "vitest";
import { ConflictError } from "../../shared/money";
import type { FraudAssessment } from "../application/fraud";
import {
  assertManuallyVerifiable,
  decidePaymentReview,
  type BankVerification,
  type PixReceiptData,
} from "./payment-review";

const APPROVED: FraudAssessment = { status: "approved", score: 0, reasons: [] };
const REJECTED: FraudAssessment = { status: "rejected", score: 100, reasons: ["Comprobante reutilizado"] };

function pix(overrides: Partial<PixReceiptData> = {}): PixReceiptData {
  return {
    amountMinor: 25000,
    currency: "BRL",
    paidAt: "2026-06-10T15:00:00Z",
    payerName: "Fulano da Silva",
    payerTaxId: "123.456.789-00",
    payerBankName: "Nubank",
    receiverName: "Preztia LTDA",
    receiverPixKey: "pix@preztia.com",
    endToEndId: "E12345678202606101500abcdef",
    txid: "TX1",
    raw: {},
    ...overrides,
  };
}

const CONFIRMED: BankVerification = { status: "confirmed", bankAmountMinor: 25000, bankPaidAt: null };

describe("decidePaymentReview", () => {
  it("rechaza por fraude si el antifraude estructural rechaza, sin importar el banco", () => {
    const decision = decidePaymentReview({ structural: REJECTED, pix: pix(), bank: CONFIRMED });
    expect(decision.kind).toBe("rejected_fraud");
  });

  it("rechaza como inválido si no hay extracción o el monto es ilegible", () => {
    expect(decidePaymentReview({ structural: APPROVED, pix: null, bank: CONFIRMED }).kind).toBe(
      "rejected_invalid",
    );
    expect(
      decidePaymentReview({ structural: APPROVED, pix: pix({ amountMinor: null }), bank: CONFIRMED }).kind,
    ).toBe("rejected_invalid");
  });

  it("banco confirma: acepta verificado con el monto BANCARIO", () => {
    const decision = decidePaymentReview({
      structural: APPROVED,
      pix: pix({ amountMinor: 24000 }), // OCR leyó distinto
      bank: { status: "confirmed", bankAmountMinor: 25000, bankPaidAt: null },
    });

    expect(decision.kind).toBe("accepted_verified");
    if (decision.kind === "accepted_verified") {
      expect(decision.amountMinor).toBe(25000); // manda el banco
      expect(decision.assessment.status).toBe("suspicious"); // la diferencia queda auditada
    }
  });

  it("banco confirma con monto igual: assessment estructural intacto", () => {
    const decision = decidePaymentReview({ structural: APPROVED, pix: pix(), bank: CONFIRMED });
    expect(decision.kind).toBe("accepted_verified");
    if (decision.kind === "accepted_verified") expect(decision.assessment).toBe(APPROVED);
  });

  it("banco no encuentra la transacción: queda UNVERIFIED sin acusar fraude", () => {
    const decision = decidePaymentReview({ structural: APPROVED, pix: pix(), bank: { status: "not_found" } });
    expect(decision.kind).toBe("accepted_unverified");
    if (decision.kind === "accepted_unverified") expect(decision.amountMinor).toBe(25000);
  });

  it("banco caído: queda UNVERIFIED para conciliación", () => {
    const decision = decidePaymentReview({
      structural: APPROVED,
      pix: pix(),
      bank: { status: "unavailable", reason: "timeout" },
    });
    expect(decision.kind).toBe("accepted_unverified");
  });
});

describe("assertManuallyVerifiable", () => {
  it("permite validar manualmente un intento fallido/pendiente", () => {
    for (const status of ["RECEIVED", "UNVERIFIED", "REJECTED_FRAUD", "REJECTED_INVALID"] as const) {
      expect(() => assertManuallyVerifiable(status)).not.toThrow();
    }
  });

  it("rechaza revalidar un pago ya VERIFIED", () => {
    expect(() => assertManuallyVerifiable("VERIFIED")).toThrow(ConflictError);
  });
});
