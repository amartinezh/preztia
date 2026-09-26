import { describe, it, expect } from "vitest";
import { DomainError, NotFoundError, type ExpenseStatus } from "@preztiaos/domain";
import { RequestExpenseHandler, ReviewExpenseHandler } from "./expenses";
import type {
  ExpenseReceiptStorage,
  ExpenseRecord,
  ExpenseStore,
  NewExpense,
} from "./ports";

const TENANT = "11111111-1111-1111-1111-111111111111";
const JPEG = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

/** Almacén en memoria: captura lo creado y aplica la revisión. */
class FakeExpenseStore implements ExpenseStore {
  created: NewExpense[] = [];
  reviews: Parameters<ExpenseStore["updateReview"]>[0][] = [];
  constructor(private record: ExpenseRecord | null = null) {}
  async create(expense: NewExpense) {
    this.created.push(expense);
  }
  async findById() {
    return this.record;
  }
  async updateReview(input: Parameters<ExpenseStore["updateReview"]>[0]) {
    this.reviews.push(input);
    return this.record ? { ...this.record, status: input.status, rejectionReason: input.rejectionReason } : null;
  }
}

class FakeReceipts implements ExpenseReceiptStorage {
  stored = 0;
  async store(input: { mimeType: string }) {
    this.stored += 1;
    return { storageKey: `k${this.stored}`, mimeType: input.mimeType, sha256: "abc" };
  }
}

function pending(zonePath: string | null, status: ExpenseStatus = "PENDING"): ExpenseRecord {
  return {
    id: "e1",
    requestedBy: "cobrador-1",
    description: "Gasolina",
    amountMinor: 15_000,
    status,
    zonePath,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
  };
}

describe("RequestExpenseHandler", () => {
  it("guarda el comprobante y crea la solicitud apuntando a él", async () => {
    const store = new FakeExpenseStore();
    const receipts = new FakeReceipts();
    const { id } = await new RequestExpenseHandler(store, receipts).execute({
      tenantId: TENANT,
      requestedBy: "cobrador-1",
      description: "Gasolina",
      amountMinor: 15_000,
      receipt: JPEG,
    });
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({ id, receipt: { storageKey: "k1", mimeType: "image/jpeg" } });
  });

  it("sin comprobante válido no guarda nada", async () => {
    const store = new FakeExpenseStore();
    const receipts = new FakeReceipts();
    const handler = new RequestExpenseHandler(store, receipts);
    const base = { tenantId: TENANT, requestedBy: "c", description: "x", amountMinor: 100 };
    await expect(handler.execute({ ...base, receipt: { bytes: new Uint8Array(), mimeType: "image/jpeg" } })).rejects.toThrow(
      DomainError,
    );
    await expect(handler.execute({ ...base, receipt: { ...JPEG, mimeType: "text/plain" } })).rejects.toThrow(DomainError);
    expect(receipts.stored).toBe(0);
    expect(store.created).toHaveLength(0);
  });
});

describe("ReviewExpenseHandler", () => {
  const review = (store: FakeExpenseStore, scopes: readonly string[] | null, extra = {}) =>
    new ReviewExpenseHandler(store).execute({
      tenantId: TENANT,
      expenseId: "e1",
      reviewerId: "coord",
      reviewerZonePaths: scopes,
      approve: false,
      rejectionReason: "Sin soporte válido",
      ...extra,
    });

  it("rechaza con motivo dentro del alcance", async () => {
    const store = new FakeExpenseStore(pending("norte.centro"));
    const result = await review(store, ["norte"]);
    expect(result).toMatchObject({ status: "REJECTED", rejectionReason: "Sin soporte válido" });
  });

  it("rechazar sin motivo falla sin persistir", async () => {
    const store = new FakeExpenseStore(pending("norte"));
    await expect(review(store, null, { rejectionReason: undefined })).rejects.toThrow(DomainError);
    expect(store.reviews).toHaveLength(0);
  });

  it("aprobar pasa la caja pagadora y no lleva motivo", async () => {
    const store = new FakeExpenseStore(pending("norte"));
    await review(store, null, { approve: true, paidFromCashBoxId: "caja-1", rejectionReason: undefined });
    expect(store.reviews[0]).toMatchObject({ status: "APPROVED", paidFromCashBoxId: "caja-1", rejectionReason: null });
  });

  it("un coordinador fuera de la zona recibe 'no existe' (404)", async () => {
    const store = new FakeExpenseStore(pending("sur"));
    await expect(review(store, ["norte"])).rejects.toThrow(NotFoundError);
    expect(store.reviews).toHaveLength(0);
  });

  it("un gasto sin zona solo lo revisa el ADMIN", async () => {
    await expect(review(new FakeExpenseStore(pending(null)), ["norte"])).rejects.toThrow(NotFoundError);
    await expect(review(new FakeExpenseStore(pending(null)), null)).resolves.toMatchObject({ status: "REJECTED" });
  });
});
