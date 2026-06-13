import { describe, expect, it } from "vitest";
import { newIdempotencyKey, uuid } from "./ids";

describe("uuid / claves", () => {
  it("genera UUID v4 con formato válido", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("genera claves de idempotencia únicas", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(1000);
  });
});
