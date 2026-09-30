import { describe, it, expect } from "vitest";
import { DomainError } from "@preztiaos/domain";

import { CreateBorrowerHandler, type DefaultCreditLimitProvider } from "./borrowers";
import type { BorrowerStore } from "./ports";

/** Store en memoria: solo captura el cupo con el que se creó el cliente. */
function fakeStore() {
  const created: { creditLimitMinor: number }[] = [];
  const store = {
    create: async (input: { creditLimitMinor: number }) => {
      created.push({ creditLimitMinor: input.creditLimitMinor });
    },
  } as unknown as BorrowerStore;
  return { store, created };
}

const defaults = (minor: number): DefaultCreditLimitProvider => ({ defaultCreditLimitMinor: async () => minor });

const base = {
  tenantId: "t",
  nationalId: " 123 ",
  firstName: "Ana",
  lastName: "",
  business: null,
  address: null,
  phone: null,
  lat: null,
  lng: null,
  color: "NONE" as const,
  creditBlocked: false,
};

describe("CreateBorrowerHandler — cupo inicial", () => {
  it("sin especificar cupo, nace con el cupo por defecto de la empresa y lo devuelve", async () => {
    const { store, created } = fakeStore();
    const result = await new CreateBorrowerHandler(store, defaults(500_000)).execute(base);
    expect(result.creditLimitMinor).toBe(500_000);
    expect(created).toEqual([{ creditLimitMinor: 500_000 }]);
  });

  it("0 explícito es 'sin límite' aunque la empresa tenga cupo por defecto", async () => {
    const { store, created } = fakeStore();
    const result = await new CreateBorrowerHandler(store, defaults(500_000)).execute({ ...base, creditLimitMinor: 0 });
    expect(result.creditLimitMinor).toBe(0);
    expect(created).toEqual([{ creditLimitMinor: 0 }]);
  });

  it("un monto explícito manda sobre el cupo por defecto", async () => {
    const { store } = fakeStore();
    const result = await new CreateBorrowerHandler(store, defaults(500_000)).execute({ ...base, creditLimitMinor: 80_000 });
    expect(result.creditLimitMinor).toBe(80_000);
  });

  it("sin proveedor de cupo por defecto, sin especificar es sin límite", async () => {
    const { store } = fakeStore();
    expect((await new CreateBorrowerHandler(store).execute(base)).creditLimitMinor).toBe(0);
  });

  it("un cupo inválido falla sin crear el cliente", async () => {
    const { store, created } = fakeStore();
    await expect(new CreateBorrowerHandler(store, defaults(0)).execute({ ...base, creditLimitMinor: -1 })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(created).toHaveLength(0);
  });
});
