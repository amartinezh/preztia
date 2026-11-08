import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultMoneyLocale } from "@preztiaos/ui/src/format/money";

import {
  getLocale,
  isLocale,
  loadStoredLocale,
  resetLocaleStoreForTests,
  setLocale,
  subscribeLocale,
} from "./locale-store";

// Almacenamiento en memoria: el store solo necesita `load/save` sobre una clave. `vi.mock` se
// eleva por encima de los imports, así que la fábrica solo puede referirse a `vi.hoisted`.
const { memory } = vi.hoisted(() => ({ memory: new Map<string, string>() }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => memory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value);
    },
  },
}));
vi.mock("../logger", () => {
  const noop = () => {};
  return { logger: { debug: noop, info: noop, warn: noop, error: noop } };
});

const STORAGE_KEY = "preztia.locale";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Especificación (Gherkin):
 *   Dado un operador que elige su idioma
 *   Cuando cambia a pt-BR
 *   Entonces la interfaz se entera (suscriptores), el dinero se formatea a la brasileña
 *   Y la preferencia sobrevive al reinicio; una preferencia corrupta cae a `es`.
 */
describe("locale store", () => {
  beforeEach(() => {
    memory.clear();
    resetLocaleStoreForTests();
  });

  it("arranca en español sin preferencia guardada", async () => {
    expect(getLocale()).toBe("es");
    expect(await loadStoredLocale()).toBe("es");
  });

  it("al cambiar notifica a los suscriptores y fija el locale del dinero", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLocale(() => seen.push(getLocale()));
    setLocale("pt-BR");
    expect(seen).toEqual(["pt-BR"]);
    expect(getDefaultMoneyLocale()).toBe("pt-BR");

    // Volver al mismo idioma no vuelve a pintar nada.
    setLocale("pt-BR");
    expect(seen).toEqual(["pt-BR"]);

    unsubscribe();
    setLocale("es");
    expect(seen).toEqual(["pt-BR"]);
    expect(getDefaultMoneyLocale()).toBe("es-CO");
  });

  it("persiste la preferencia y la vuelve a leer al arrancar", async () => {
    setLocale("pt-BR");
    await flush();
    expect(memory.get(STORAGE_KEY)).toBe("pt-BR");

    resetLocaleStoreForTests();
    expect(getLocale()).toBe("es");
    expect(await loadStoredLocale()).toBe("pt-BR");
    expect(getLocale()).toBe("pt-BR");
    expect(getDefaultMoneyLocale()).toBe("pt-BR");
  });

  it("la primera suscripción lee la preferencia guardada (arranque de la app)", async () => {
    memory.set(STORAGE_KEY, "pt-BR");
    const seen: string[] = [];
    subscribeLocale(() => seen.push(getLocale()));
    await flush();
    expect(seen).toEqual(["pt-BR"]);
  });

  it("ignora una preferencia guardada que no es un idioma soportado", async () => {
    memory.set(STORAGE_KEY, "fr");
    expect(await loadStoredLocale()).toBe("es");
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale(null)).toBe(false);
  });
});
