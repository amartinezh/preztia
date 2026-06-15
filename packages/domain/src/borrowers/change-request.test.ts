import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import { decideChangeRequest } from "./change-request";

describe("decideChangeRequest", () => {
  it("aprueba/rechaza una solicitud pendiente", () => {
    expect(decideChangeRequest("PENDING", true)).toBe("APPROVED");
    expect(decideChangeRequest("PENDING", false)).toBe("REJECTED");
  });

  it("no permite revisar una solicitud ya resuelta", () => {
    expect(() => decideChangeRequest("APPROVED", true)).toThrow(DomainError);
    expect(() => decideChangeRequest("REJECTED", false)).toThrow(DomainError);
  });
});
