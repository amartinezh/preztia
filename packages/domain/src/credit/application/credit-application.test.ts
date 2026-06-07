import { describe, it, expect } from "vitest";
import {
  createCreditApplication,
  isComplete,
  nextPendingDocument,
  recordDocumentOutcome,
  type CreditApplication,
} from "./credit-application";
import { DomainError } from "../../shared/money";
import type { FraudAssessment } from "./fraud";
import { REQUESTED_DOCUMENTS } from "./required-document";

const approved: FraudAssessment = { status: "approved", score: 0, reasons: [] };
const rejected: FraudAssessment = { status: "rejected", score: 100, reasons: ["formato no permitido"] };

const fresh = (): CreditApplication => createCreditApplication(REQUESTED_DOCUMENTS);
// Destructurar evita el `| undefined` del acceso por índice (noUncheckedIndexedAccess).
const [FIRST] = REQUESTED_DOCUMENTS;

describe("createCreditApplication", () => {
  it("crea la solicitud con el checklist solicitado, todos PENDING y AWAITING_DOCUMENTS", () => {
    const app = fresh();
    expect(app.status).toBe("AWAITING_DOCUMENTS");
    expect(app.documents.map((d) => d.type)).toEqual([...REQUESTED_DOCUMENTS]);
    expect(app.documents.every((d) => d.status === "PENDING")).toBe(true);
  });

  it("rechaza un checklist vacío o con duplicados", () => {
    expect(() => createCreditApplication([])).toThrow(DomainError);
    expect(() => createCreditApplication(["IDENTITY_DOCUMENT", "IDENTITY_DOCUMENT"])).toThrow(DomainError);
  });
});

describe("nextPendingDocument", () => {
  it("sigue el orden de REQUESTED_DOCUMENTS y devuelve null al completar", () => {
    let app = fresh();
    expect(nextPendingDocument(app)).toBe(REQUESTED_DOCUMENTS[0]);

    app = recordDocumentOutcome(app, FIRST, approved);
    expect(nextPendingDocument(app)).toBe(REQUESTED_DOCUMENTS[1]);

    for (const type of REQUESTED_DOCUMENTS) app = recordDocumentOutcome(app, type, approved);
    expect(nextPendingDocument(app)).toBeNull();
  });
});

describe("recordDocumentOutcome", () => {
  it("aprobado → VALIDATED; al validar todos pasa a IN_REVIEW", () => {
    let app = fresh();
    for (const type of REQUESTED_DOCUMENTS) app = recordDocumentOutcome(app, type, approved);
    expect(isComplete(app)).toBe(true);
    expect(app.status).toBe("IN_REVIEW");
    expect(app.documents.every((d) => d.status === "VALIDATED")).toBe(true);
  });

  it("rechazado → REJECTED y la solicitud sigue AWAITING_DOCUMENTS", () => {
    const app = recordDocumentOutcome(fresh(), FIRST, rejected);
    const doc = app.documents.find((d) => d.type === REQUESTED_DOCUMENTS[0]);
    expect(doc?.status).toBe("REJECTED");
    expect(app.status).toBe("AWAITING_DOCUMENTS");
    // El documento rechazado vuelve a ser el siguiente pendiente.
    expect(nextPendingDocument(app)).toBe(REQUESTED_DOCUMENTS[0]);
  });

  it("es idempotente: re-registrar un documento ya VALIDATED no lo degrada", () => {
    const once = recordDocumentOutcome(fresh(), FIRST, approved);
    const twice = recordDocumentOutcome(once, FIRST, rejected);
    expect(twice).toBe(once); // misma instancia: sin cambios
  });

  it("rechaza un documento ajeno al checklist", () => {
    expect(() => recordDocumentOutcome(fresh(), "BANK_STATEMENT", approved)).toThrow(DomainError);
  });
});
