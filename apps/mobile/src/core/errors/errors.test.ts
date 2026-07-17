import { describe, expect, it } from "vitest";
import { ApiError, isApiError, networkError, normalizeHttpError } from "./index";

describe("normalizeHttpError", () => {
  it("mapea códigos HTTP a claves de mensaje estables", () => {
    expect(normalizeHttpError(401, null).messageKey).toBe("errors.unauthorized");
    expect(normalizeHttpError(403, null).messageKey).toBe("errors.forbidden");
    expect(normalizeHttpError(404, null).messageKey).toBe("errors.notFound");
    expect(normalizeHttpError(409, null).messageKey).toBe("errors.conflict");
    expect(normalizeHttpError(400, null).messageKey).toBe("errors.validation");
    expect(normalizeHttpError(500, null).messageKey).toBe("errors.server");
  });

  it("conserva el código de dominio y correlationId del backend", () => {
    const err = normalizeHttpError(409, { code: "INSUFFICIENT_BALANCE" }, "corr-1");
    expect(err.domainCode).toBe("INSUFFICIENT_BALANCE");
    expect(err.correlationId).toBe("corr-1");
  });

  it("prefiere el mensaje específico cuando el código de dominio es conocido", () => {
    expect(normalizeHttpError(409, { code: "NO_DEFAULT_PLAN" }).messageKey).toBe(
      "errors.plans.noDefault",
    );
    expect(normalizeHttpError(409, { code: "NO_ACTIVE_PLANS" }).messageKey).toBe(
      "errors.plans.noActive",
    );
    // Un código desconocido cae al genérico por status.
    expect(normalizeHttpError(409, { code: "OTRO" }).messageKey).toBe("errors.conflict");
  });

  it("distingue timeout de red caída", () => {
    expect(networkError(true).messageKey).toBe("errors.timeout");
    expect(networkError(false).messageKey).toBe("errors.network");
  });

  it("isApiError reconoce instancias", () => {
    expect(isApiError(new ApiError({ status: 500, messageKey: "errors.server" }))).toBe(true);
    expect(isApiError(new Error("x"))).toBe(false);
  });
});
