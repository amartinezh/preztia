import { describe, it, expect } from "vitest";
import {
  buildChargeInstructionsMessage,
  buildPaymentOptionsMessage,
  detectPaymentIntent,
  parsePaymentChoice,
} from "./payment-intent";

describe("detectPaymentIntent", () => {
  it("reconoce la intención explícita de pago (ES y PT)", () => {
    for (const text of [
      "quiero pagar",
      "Quiero pagar mi cuota",
      "voy a pagar",
      "deseo hacer un pago",
      "quero pagar",
      "vou pagar",
      "necesito abonar algo",
      "hago el pago hoy",
      "pagamento",
      "quiero quitar mi deuda",
      "cómo pago por pix?",
    ]) {
      expect(detectPaymentIntent(text)).toBe(true);
    }
  });

  it("ignora mensajes sin intención de pago", () => {
    for (const text of [
      "hola, buenos días",
      "cuánto es el interés?",
      "quiero solicitar un crédito",
      "gracias",
      "",
    ]) {
      expect(detectPaymentIntent(text)).toBe(false);
    }
  });

  it("es robusto a acentos y mayúsculas", () => {
    expect(detectPaymentIntent("PAGAR")).toBe(true);
    expect(detectPaymentIntent("Cancelar mi deuda")).toBe(true);
  });
});

describe("parsePaymentChoice", () => {
  const options = { installmentMinor: 25000, overdueMinor: 75000 };

  it("mapea el selector 1 a la cuota del día", () => {
    expect(parsePaymentChoice("1", options)).toEqual({
      kind: "installment",
      amountMinor: 25000,
    });
    expect(parsePaymentChoice("cuota", options)).toEqual({
      kind: "installment",
      amountMinor: 25000,
    });
  });

  it("mapea el selector 2 a todo lo vencido", () => {
    expect(parsePaymentChoice("2", options)).toEqual({
      kind: "overdue",
      amountMinor: 75000,
    });
    expect(parsePaymentChoice("todo", options)).toEqual({
      kind: "overdue",
      amountMinor: 75000,
    });
  });

  it("interpreta un monto libre en unidades mayores (150 → 15000)", () => {
    expect(parsePaymentChoice("150", options)).toEqual({
      kind: "custom",
      amountMinor: 15000,
    });
    expect(parsePaymentChoice("quiero pagar 300", options)).toEqual({
      kind: "custom",
      amountMinor: 30000,
    });
  });

  it("interpreta decimales con coma o punto (150,50 → 15050)", () => {
    expect(parsePaymentChoice("150,50", options)).toEqual({
      kind: "custom",
      amountMinor: 15050,
    });
    expect(parsePaymentChoice("R$ 1.234,56", options)).toEqual({
      kind: "custom",
      amountMinor: 123456,
    });
  });

  it("acepta un monto MENOR que la cuota (abono parcial)", () => {
    expect(parsePaymentChoice("100", options)).toEqual({
      kind: "custom",
      amountMinor: 10000,
    });
  });

  it("pide de nuevo ante texto ilegible o cero", () => {
    expect(parsePaymentChoice("no sé", options)).toEqual({ kind: "reask" });
    expect(parsePaymentChoice("0", options)).toEqual({ kind: "reask" });
  });
});

describe("buildPaymentOptionsMessage", () => {
  it("ofrece cuota y total cuando hay atrasos", () => {
    const msg = buildPaymentOptionsMessage({
      firstName: "Ana",
      installmentMinor: 25000,
      overdueMinor: 75000,
      currency: "BRL",
    });
    expect(msg).toContain("Ana");
    expect(msg).toContain("R$ 250,00");
    expect(msg).toContain("R$ 750,00");
    expect(msg).toContain("otro monto");
  });

  it("omite la opción 2 cuando no hay atrasos (vencido = cuota)", () => {
    const msg = buildPaymentOptionsMessage({
      firstName: "Ana",
      installmentMinor: 25000,
      overdueMinor: 25000,
      currency: "BRL",
    });
    expect(msg).not.toContain("2️⃣");
  });
});

describe("buildChargeInstructionsMessage", () => {
  it("incluye el monto formateado y el código copia-e-cola", () => {
    const msg = buildChargeInstructionsMessage({
      amountMinor: 15000,
      currency: "BRL",
      copyPasteCode: "00020126PIXCODE...",
      expiresInMinutes: 15,
    });
    expect(msg).toContain("R$ 150,00");
    expect(msg).toContain("00020126PIXCODE...");
    expect(msg).toContain("15 minutos");
  });
});
