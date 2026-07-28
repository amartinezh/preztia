import { describe, it, expect } from "vitest";
import {
  createCreditApplication,
  decideApplicationReview,
  documentOf,
  isComplete,
  nextPendingDocument,
  pendingFilesOf,
  recordDocumentOutcome,
  recordDocumentResult,
  type CreditApplication,
} from "./credit-application";
import { DomainError } from "../../shared/money";
import type { FraudAssessment } from "./fraud";
import { REQUESTED_DOCUMENTS } from "./required-document";

const approved: FraudAssessment = { status: "approved", score: 0, reasons: [] };
const rejected: FraudAssessment = { status: "rejected", score: 100, reasons: ["formato no permitido"] };

// Checklist por defecto, un archivo por documento (el caso simple).
const single = REQUESTED_DOCUMENTS.map((type) => ({ type, expectedFiles: 1 }));
const fresh = (): CreditApplication => createCreditApplication(single);
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
    expect(() =>
      createCreditApplication([
        { type: "IDENTITY_DOCUMENT", expectedFiles: 1 },
        { type: "IDENTITY_DOCUMENT", expectedFiles: 1 },
      ]),
    ).toThrow(DomainError);
    expect(() =>
      createCreditApplication([{ type: "IDENTITY_DOCUMENT", expectedFiles: 0 }]),
    ).toThrow(DomainError);
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

describe("documentos de varios archivos", () => {
  // Cédula por ambos lados (2 archivos) seguida de un documento de un solo archivo.
  const twoSided = (): CreditApplication =>
    createCreditApplication([
      { type: "IDENTITY_DOCUMENT", expectedFiles: 2 },
      { type: "BUSINESS_VALIDITY_CERTIFICATE", expectedFiles: 1 },
    ]);

  it("el primer archivo deja el documento RECEIVED, no VALIDATED, y no avanza el checklist", () => {
    const app = recordDocumentResult(twoSided(), "IDENTITY_DOCUMENT", true);
    const doc = documentOf(app, "IDENTITY_DOCUMENT");

    expect(doc.status).toBe("RECEIVED");
    expect(doc.receivedFiles).toBe(1);
    expect(pendingFilesOf(app, "IDENTITY_DOCUMENT")).toBe(1);
    // Sigue siendo el documento pendiente: la segunda foto NO se juzga contra el siguiente.
    expect(nextPendingDocument(app)).toBe("IDENTITY_DOCUMENT");
  });

  it("al reunir todos los archivos pasa a VALIDATED y avanza al siguiente documento", () => {
    let app = recordDocumentResult(twoSided(), "IDENTITY_DOCUMENT", true);
    app = recordDocumentResult(app, "IDENTITY_DOCUMENT", true);

    expect(documentOf(app, "IDENTITY_DOCUMENT").status).toBe("VALIDATED");
    expect(pendingFilesOf(app, "IDENTITY_DOCUMENT")).toBe(0);
    expect(nextPendingDocument(app)).toBe("BUSINESS_VALIDITY_CERTIFICATE");
  });

  it("invariante: receivedFiles nunca supera expectedFiles", () => {
    let app = twoSided();
    for (let i = 0; i < 5; i += 1) app = recordDocumentResult(app, "IDENTITY_DOCUMENT", true);

    const doc = documentOf(app, "IDENTITY_DOCUMENT");
    expect(doc.receivedFiles).toBe(doc.expectedFiles);
  });

  it("un rechazo no consume cupo de archivo", () => {
    let app = recordDocumentResult(twoSided(), "IDENTITY_DOCUMENT", true);
    app = recordDocumentResult(app, "IDENTITY_DOCUMENT", false);

    const doc = documentOf(app, "IDENTITY_DOCUMENT");
    expect(doc.status).toBe("REJECTED");
    expect(doc.receivedFiles).toBe(1); // el anverso válido no se pierde
  });
});

describe("intentos fallidos", () => {
  it("cada rechazo suma un intento", () => {
    let app = recordDocumentResult(fresh(), FIRST, false);
    expect(documentOf(app, FIRST).mismatchAttempts).toBe(1);

    app = recordDocumentResult(app, FIRST, false);
    expect(documentOf(app, FIRST).mismatchAttempts).toBe(2);
  });

  it("un archivo válido reinicia los intentos del documento", () => {
    let app = recordDocumentResult(fresh(), FIRST, false);
    app = recordDocumentResult(app, FIRST, true);
    expect(documentOf(app, FIRST).mismatchAttempts).toBe(0);
  });

  it("un envío que llega con el documento ya VALIDATED no gasta intento ni degrada el estado", () => {
    const validated = recordDocumentResult(fresh(), FIRST, true);
    // La foto del reverso que el solicitante mandó de más, o un webhook reentregado.
    const late = recordDocumentResult(validated, FIRST, false);

    expect(late).toBe(validated); // misma instancia: sin cambios
    expect(documentOf(late, FIRST).mismatchAttempts).toBe(0);
    expect(documentOf(late, FIRST).status).toBe("VALIDATED");
  });
});

describe("decideApplicationReview", () => {
  // Lleva la solicitud a IN_REVIEW validando todos los documentos.
  const inReview = (): CreditApplication =>
    REQUESTED_DOCUMENTS.reduce((app, type) => recordDocumentOutcome(app, type, approved), fresh());

  it("aprueba desde IN_REVIEW → APPROVED", () => {
    expect(decideApplicationReview(inReview(), "APPROVE").status).toBe("APPROVED");
  });

  it("aprueba desde AWAITING_DOCUMENTS aunque un documento quedó marcado", () => {
    const flagged = recordDocumentOutcome(fresh(), FIRST, rejected);
    expect(flagged.status).toBe("AWAITING_DOCUMENTS");
    expect(decideApplicationReview(flagged, "APPROVE").status).toBe("APPROVED");
  });

  it("rechaza desde IN_REVIEW → REJECTED", () => {
    expect(decideApplicationReview(inReview(), "REJECT").status).toBe("REJECTED");
  });

  it("es idempotente: re-decidir hacia el mismo estado no cambia nada", () => {
    const approvedApp = decideApplicationReview(inReview(), "APPROVE");
    expect(decideApplicationReview(approvedApp, "APPROVE")).toBe(approvedApp);
  });

  it("es un conflicto cambiar de un estado terminal al otro", () => {
    const approvedApp = decideApplicationReview(inReview(), "APPROVE");
    expect(() => decideApplicationReview(approvedApp, "REJECT")).toThrow(DomainError);
  });
});
