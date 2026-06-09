import { describe, it, expect } from "vitest";
import { decideDocumentReview, type DocumentIdentification } from "./document-review";
import type { FraudAssessment } from "./fraud";

const structuralOk: FraudAssessment = { status: "approved", score: 0, reasons: [] };
const structuralBad: FraudAssessment = { status: "rejected", score: 100, reasons: ["formato no permitido"] };
const match: DocumentIdentification = { matchesExpected: true, clearlyIdentified: true };
const mismatch: DocumentIdentification = { matchesExpected: false, clearlyIdentified: true };
const unclear: DocumentIdentification = { matchesExpected: false, clearlyIdentified: false };

const decide = (over: Partial<Parameters<typeof decideDocumentReview>[0]> = {}) =>
  decideDocumentReview({
    structural: structuralOk,
    identification: match,
    priorMismatchAttempts: 0,
    maxAttempts: 3,
    ...over,
  });

describe("decideDocumentReview", () => {
  it("rechaza por antifraude estructural sin mirar la IA", () => {
    expect(decide({ structural: structuralBad, identification: mismatch })).toEqual({
      kind: "structural_reject",
      reasons: ["formato no permitido"],
    });
  });

  it("acepta cuando coincide y se identificó con claridad", () => {
    expect(decide({ identification: match }).kind).toBe("accepted");
  });

  it("acepta (degradación elegante) si la IA no estuvo disponible", () => {
    expect(decide({ identification: null }).kind).toBe("accepted");
  });

  it("acepta el documento correcto aunque ya se hubieran superado los intentos", () => {
    expect(decide({ identification: match, priorMismatchAttempts: 9 }).kind).toBe("accepted");
  });

  it("reintenta cuando no coincide y quedan intentos, informando cuántos faltan", () => {
    expect(decide({ identification: mismatch, priorMismatchAttempts: 0, maxAttempts: 3 })).toEqual({
      kind: "mismatch_retry",
      attemptsLeft: 2,
    });
  });

  it("trata 'no identificado con claridad' igual que un no-coincide (reintento)", () => {
    expect(decide({ identification: unclear, priorMismatchAttempts: 0, maxAttempts: 3 }).kind).toBe(
      "mismatch_retry",
    );
  });

  it("ofrece revisión manual al alcanzar el máximo de intentos", () => {
    expect(decide({ identification: mismatch, priorMismatchAttempts: 2, maxAttempts: 3 }).kind).toBe(
      "offer_manual_review",
    );
  });

  it("acepta para revisión manual si insiste por encima del máximo", () => {
    expect(decide({ identification: mismatch, priorMismatchAttempts: 3, maxAttempts: 3 }).kind).toBe(
      "accepted_for_manual_review",
    );
  });
});
