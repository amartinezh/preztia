import { describe, expect, it } from "vitest";
import { DomainError, type ClientLanguage } from "@preztiaos/domain";
import { UpdateClientLanguageHandler, type ClientLanguageStore } from "./client-language";

class MemoryStore implements ClientLanguageStore {
  readonly saved: { tenantId: string; language: ClientLanguage }[] = [];
  async get(): Promise<ClientLanguage> {
    return this.saved.at(-1)?.language ?? "es";
  }
  async save(input: { tenantId: string; language: ClientLanguage }): Promise<void> {
    this.saved.push(input);
  }
}

describe("UpdateClientLanguageHandler", () => {
  it("guarda el idioma soportado y lo devuelve", async () => {
    const store = new MemoryStore();
    const result = await new UpdateClientLanguageHandler(store).execute({
      tenantId: "t1",
      language: "pt-BR",
    });

    expect(result).toEqual({ language: "pt-BR" });
    expect(store.saved).toEqual([{ tenantId: "t1", language: "pt-BR" }]);
  });

  it("rechaza un idioma no soportado sin persistir nada", async () => {
    const store = new MemoryStore();
    await expect(
      new UpdateClientLanguageHandler(store).execute({ tenantId: "t1", language: "fr" }),
    ).rejects.toThrow(DomainError);
    expect(store.saved).toHaveLength(0);
  });
});
