import { describe, expect, it } from "vitest";
import { logger } from "./index";

describe("logger PII redaction", () => {
  it("enmascara claves sensibles a cualquier profundidad", () => {
    const redacted = logger._redact({
      amountMinor: 5000,
      payerName: "Juana Pérez",
      nested: { cpf: "123.456.789-00", ok: "visible" },
      list: [{ token: "abc" }],
    }) as Record<string, unknown>;

    expect(redacted.amountMinor).toBe(5000);
    expect(redacted.payerName).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).cpf).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).ok).toBe("visible");
    expect((redacted.list as Record<string, unknown>[])[0]!.token).toBe("[REDACTED]");
  });
});
