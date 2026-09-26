import { describe, it, expect } from "vitest";
import { ConflictError, DomainError } from "../shared/money";
import {
  assertCanPayExpenseFrom,
  assertValidExpenseReceipt,
  EXPENSE_RECEIPT_MAX_BYTES,
  reviewExpense,
} from "./expense";

describe("reviewExpense", () => {
  it("aprobar deja APPROVED sin motivo de rechazo", () => {
    expect(reviewExpense({ current: "PENDING", approve: true })).toEqual({
      status: "APPROVED",
      rejectionReason: null,
    });
  });

  it("rechazar exige un motivo y lo conserva sin espacios", () => {
    expect(reviewExpense({ current: "PENDING", approve: false, rejectionReason: "  Sin soporte  " })).toEqual({
      status: "REJECTED",
      rejectionReason: "Sin soporte",
    });
    expect(() => reviewExpense({ current: "PENDING", approve: false })).toThrow(DomainError);
    expect(() => reviewExpense({ current: "PENDING", approve: false, rejectionReason: " no " })).toThrow(
      DomainError,
    );
  });

  it("un gasto ya revisado no se revisa de nuevo", () => {
    expect(() => reviewExpense({ current: "APPROVED", approve: true })).toThrow(DomainError);
    expect(() => reviewExpense({ current: "REJECTED", approve: false, rejectionReason: "Otra vez" })).toThrow(
      DomainError,
    );
  });
});

describe("assertValidExpenseReceipt", () => {
  it("acepta imágenes y PDF dentro del tamaño máximo", () => {
    for (const mimeType of ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]) {
      expect(() => assertValidExpenseReceipt({ mimeType, sizeBytes: 1024 })).not.toThrow();
    }
  });

  it("rechaza archivos vacíos, demasiado grandes o de otro tipo", () => {
    expect(() => assertValidExpenseReceipt({ mimeType: "image/jpeg", sizeBytes: 0 })).toThrow(DomainError);
    expect(() =>
      assertValidExpenseReceipt({ mimeType: "image/jpeg", sizeBytes: EXPENSE_RECEIPT_MAX_BYTES + 1 }),
    ).toThrow(DomainError);
    expect(() => assertValidExpenseReceipt({ mimeType: "text/html", sizeBytes: 10 })).toThrow(DomainError);
  });
});

describe("assertCanPayExpenseFrom", () => {
  const requestedBy = "cobrador-1";

  it("paga desde una caja de oficina o banco que la zona del gasto puede usar", () => {
    expect(() =>
      assertCanPayExpenseFrom({
        requestedBy,
        expenseZonePath: "norte.centro",
        box: { assignedTo: null, zonePath: "norte" },
      }),
    ).not.toThrow();
    expect(() =>
      assertCanPayExpenseFrom({ requestedBy, expenseZonePath: "norte", box: { assignedTo: null, zonePath: null } }),
    ).not.toThrow();
  });

  it("paga desde la caja de ruta de quien lo pidió", () => {
    expect(() =>
      assertCanPayExpenseFrom({
        requestedBy,
        expenseZonePath: "norte",
        box: { assignedTo: requestedBy, zonePath: "norte" },
      }),
    ).not.toThrow();
  });

  it("nunca desde la caja de ruta de otro cobrador", () => {
    try {
      assertCanPayExpenseFrom({
        requestedBy,
        expenseZonePath: "norte",
        box: { assignedTo: "cobrador-2", zonePath: "norte" },
      });
      throw new Error("debió fallar");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).code).toBe("EXPENSE_BOX_NOT_ALLOWED");
    }
  });

  it("una caja de otra zona no paga el gasto", () => {
    expect(() =>
      assertCanPayExpenseFrom({ requestedBy, expenseZonePath: "sur", box: { assignedTo: null, zonePath: "norte" } }),
    ).toThrow(ConflictError);
  });

  it("un gasto sin zona (del tenant) solo se paga con cajas del tenant", () => {
    expect(() =>
      assertCanPayExpenseFrom({ requestedBy, expenseZonePath: null, box: { assignedTo: null, zonePath: null } }),
    ).not.toThrow();
    expect(() =>
      assertCanPayExpenseFrom({ requestedBy, expenseZonePath: null, box: { assignedTo: null, zonePath: "norte" } }),
    ).toThrow(ConflictError);
  });
});
