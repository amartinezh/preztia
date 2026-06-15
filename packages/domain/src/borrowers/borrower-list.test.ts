import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { assertListName } from "./borrower-list";

describe("assertListName", () => {
  it("acepta nombres válidos", () => {
    expect(() => assertListName("Clientes morosos")).not.toThrow();
  });
  it("rechaza vacío o solo espacios", () => {
    expect(() => assertListName("   ")).toThrow(DomainError);
  });
  it("rechaza nombres demasiado largos", () => {
    expect(() => assertListName("x".repeat(81))).toThrow(DomainError);
  });
});
