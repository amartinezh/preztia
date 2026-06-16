import { describe, it, expect } from "vitest";
import { parsePlanSelection, parseAcceptance } from "./plan-reply";

describe("parsePlanSelection", () => {
  it("acepta un número dentro del rango ofrecido", () => {
    expect(parsePlanSelection("2", 3)).toBe(2);
    expect(parsePlanSelection("  3 ", 3)).toBe(3);
    expect(parsePlanSelection("opción 1", 3)).toBe(1);
  });

  it("rechaza fuera de rango o sin número", () => {
    expect(parsePlanSelection("0", 3)).toBeNull();
    expect(parsePlanSelection("4", 3)).toBeNull();
    expect(parsePlanSelection("no sé", 3)).toBeNull();
  });
});

describe("parseAcceptance", () => {
  it("interpreta variantes de aceptación", () => {
    expect(parseAcceptance("sí")).toBe("ACCEPT");
    expect(parseAcceptance("Si")).toBe("ACCEPT");
    expect(parseAcceptance("acepto")).toBe("ACCEPT");
    expect(parseAcceptance("dale ok")).toBe("ACCEPT");
  });

  it("interpreta variantes de rechazo", () => {
    expect(parseAcceptance("no")).toBe("DECLINE");
    expect(parseAcceptance("no acepto")).toBe("DECLINE");
    expect(parseAcceptance("rechazo")).toBe("DECLINE");
  });

  it("devuelve null ante ambigüedad", () => {
    expect(parseAcceptance("tal vez mañana")).toBeNull();
    expect(parseAcceptance("")).toBeNull();
  });
});
