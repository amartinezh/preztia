import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import {
  assertCanPost,
  boxBalanceMinor,
  buildTransfer,
  type CashBoxType,
  type LedgerEntry,
  type PostingIntent,
} from "./cash-box";

function entry(direction: "IN" | "OUT", amountMinor: number): LedgerEntry {
  return { direction, amountMinor };
}

function intent(overrides: Partial<PostingIntent> = {}): PostingIntent {
  return { direction: "IN", kind: "PAYMENT_IN", amountMinor: 10000, reason: null, ...overrides };
}

function canPost(type: CashBoxType, currentBalanceMinor: number, i: PostingIntent): void {
  assertCanPost({ type, currentBalanceMinor, intent: i });
}

describe("boxBalanceMinor", () => {
  it("suma las entradas y resta las salidas", () => {
    expect(boxBalanceMinor([entry("IN", 50000), entry("OUT", 20000), entry("IN", 5000)])).toBe(35000);
  });

  it("una caja sin asientos tiene saldo cero", () => {
    expect(boxBalanceMinor([])).toBe(0);
  });
});

describe("assertCanPost", () => {
  it("rechaza montos no positivos o no enteros", () => {
    expect(() => canPost("BANK", 0, intent({ amountMinor: 0 }))).toThrow(DomainError);
    expect(() => canPost("BANK", 0, intent({ amountMinor: -1 }))).toThrow(DomainError);
    expect(() => canPost("BANK", 0, intent({ amountMinor: 1.5 }))).toThrow(DomainError);
  });

  it("exige motivo en la caja menor (CASH), aunque sea un ingreso", () => {
    expect(() => canPost("CASH", 0, intent({ reason: null }))).toThrow(/motivo/i);
    expect(() => canPost("CASH", 0, intent({ reason: "   " }))).toThrow(/motivo/i);
    expect(() => canPost("CASH", 0, intent({ reason: "Aporte del socio" }))).not.toThrow();
  });

  it("exige motivo en todo retiro, sin importar el tipo de caja", () => {
    const withdrawal = intent({ direction: "OUT", kind: "WITHDRAWAL", reason: null });
    expect(() => canPost("BANK", 50000, withdrawal)).toThrow(/motivo/i);
    expect(() => canPost("BANK", 50000, { ...withdrawal, reason: "Pago proveedor" })).not.toThrow();
  });

  it("no exige motivo para un ingreso bancario normal (PIX)", () => {
    expect(() => canPost("BANK", 0, intent({ reason: null }))).not.toThrow();
  });

  it("rechaza una salida que deja la caja en negativo (sin sobregiro)", () => {
    const out = intent({ direction: "OUT", kind: "WITHDRAWAL", amountMinor: 50001, reason: "x" });
    expect(() => canPost("BANK", 50000, out)).toThrow(/insuficiente/i);
    expect(() => canPost("BANK", 50001, out)).not.toThrow();
  });

  it("permite dejar la caja exactamente en cero", () => {
    const out = intent({ direction: "OUT", kind: "WITHDRAWAL", amountMinor: 50000, reason: "x" });
    expect(() => canPost("BANK", 50000, out)).not.toThrow();
  });

  it("un desembolso (DISBURSEMENT) no puede sobregirar la caja/cuenta origen", () => {
    const out = intent({ direction: "OUT", kind: "DISBURSEMENT", amountMinor: 100000, reason: "Desembolso crédito" });
    expect(() => canPost("BANK", 99999, out)).toThrow(/insuficiente/i);
    expect(() => canPost("BANK", 100000, out)).not.toThrow();
  });

  it("la caja de tránsito solo libera fondos por transferencia", () => {
    const withdrawal = intent({ direction: "OUT", kind: "WITHDRAWAL", amountMinor: 1000, reason: "x" });
    const transfer = intent({ direction: "OUT", kind: "TRANSFER", amountMinor: 1000, reason: "Reclasificación" });
    expect(() => canPost("TRANSIT", 5000, withdrawal)).toThrow(/transferencia/i);
    expect(() => canPost("TRANSIT", 5000, transfer)).not.toThrow();
  });
});

describe("cuadre de tesorería (conservación del dinero)", () => {
  // Aplica un asiento a una caja: valida el invariante (no sobregiro) y devuelve el nuevo saldo.
  function apply(type: CashBoxType, balanceMinor: number, i: PostingIntent): number {
    assertCanPost({ type, currentBalanceMinor: balanceMinor, intent: i });
    return balanceMinor + (i.direction === "IN" ? i.amountMinor : -i.amountMinor);
  }

  it("desembolso/cobro/gasto no sobregiran y Σ saldos = inicial − desembolsos + cobros − gastos", () => {
    let efectivo = 1_000_00; // caja de oficina
    let banco = 5_000_00; // cuenta bancaria
    const inicial = efectivo + banco;

    // Desembolso de un crédito: sale de la cuenta bancaria (OUT DISBURSEMENT).
    banco = apply("BANK", banco, intent({ direction: "OUT", kind: "DISBURSEMENT", amountMinor: 800_00, reason: "Desembolso de crédito" }));
    // Cobro del cliente por PIX: entra a la cuenta bancaria (IN PAYMENT_IN).
    banco = apply("BANK", banco, intent({ direction: "IN", kind: "PAYMENT_IN", amountMinor: 120_00 }));
    // Gasto aprobado, pagado desde la caja de efectivo (OUT EXPENSE; CASH exige motivo).
    efectivo = apply("CASH", efectivo, intent({ direction: "OUT", kind: "EXPENSE", amountMinor: 50_00, reason: "Combustible" }));

    const liquidez = efectivo + banco;
    // Invariante de conservación: la liquidez refleja exactamente los movimientos del período.
    expect(liquidez).toBe(inicial - 800_00 + 120_00 - 50_00);
    expect(liquidez).toBe(5_270_00);
  });

  it("un desembolso que excede la liquidez de la caja origen se rechaza (protege el dinero)", () => {
    const banco = 500_00;
    expect(() =>
      apply("BANK", banco, intent({ direction: "OUT", kind: "DISBURSEMENT", amountMinor: 500_01, reason: "Desembolso" })),
    ).toThrow(/insuficiente/i);
  });
});

describe("buildTransfer", () => {
  it("produce dos patas balanceadas (Σ = 0) por el mismo monto", () => {
    const { out, in: incoming } = buildTransfer({ amountMinor: 30000, reason: "Clasifica tránsito" });
    expect(out.direction).toBe("OUT");
    expect(incoming.direction).toBe("IN");
    expect(out.amountMinor).toBe(incoming.amountMinor);
    expect(boxBalanceMinor([out, incoming])).toBe(0);
    expect(out.kind).toBe("TRANSFER");
    expect(incoming.kind).toBe("TRANSFER");
  });

  it("rechaza montos no positivos", () => {
    expect(() => buildTransfer({ amountMinor: 0, reason: null })).toThrow(DomainError);
    expect(() => buildTransfer({ amountMinor: -10, reason: null })).toThrow(DomainError);
  });
});
