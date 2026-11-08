import { useSyncExternalStore } from "react";
// Import profundo a propósito: el índice de `@preztiaos/ui` arrastra react-native (Flow) y este
// módulo lo importa toda la app, incluidas las pruebas unitarias en node. El formato de dinero es
// TypeScript puro.
import { setDefaultMoneyLocale } from "@preztiaos/ui/src/format/money";

import { logger } from "../logger";
import { localeStorage } from "./locale-storage";

/**
 * Store mínimo (sin librerías) del idioma de la interfaz del OPERADOR. Es un valor de módulo con
 * suscriptores: `useLocale`/`useT` lo leen con `useSyncExternalStore`, así que toda la pantalla se
 * vuelve a pintar al cambiar el idioma. La preferencia se guarda en el dispositivo y se lee al
 * arrancar (en la primera suscripción); sin preferencia válida queda `es`.
 *
 * El idioma en que se atiende al CLIENTE por chat es otro ajuste, por empresa (ADR #47).
 */

export type Locale = "es" | "pt-BR";

export const DEFAULT_LOCALE: Locale = "es";
export const SUPPORTED_LOCALES: readonly Locale[] = ["es", "pt-BR"];

// Locale de `Intl` con el que se formatea el dinero en cada idioma: es → Colombia, pt-BR → Brasil.
const MONEY_LOCALE: Record<Locale, string> = { es: "es-CO", "pt-BR": "pt-BR" };

let current: Locale = DEFAULT_LOCALE;
let bootstrapped = false;
const listeners = new Set<() => void>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getLocale(): Locale {
  return current;
}

function apply(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  setDefaultMoneyLocale(MONEY_LOCALE[locale]);
  listeners.forEach((listener) => listener());
}

/** Cambia el idioma del operador: notifica a la UI y guarda la preferencia (sin disco, no bloquea). */
export function setLocale(locale: Locale): void {
  apply(locale);
  localeStorage.save(locale).catch(() => logger.warn("locale_persist_failed", {}, { locale }));
}

/** Lee la preferencia guardada y la aplica si es un idioma soportado; devuelve el idioma vigente. */
export async function loadStoredLocale(): Promise<Locale> {
  try {
    const stored = await localeStorage.load();
    if (isLocale(stored)) apply(stored);
  } catch {
    // Sin almacenamiento disponible: se sigue con el idioma por defecto, nunca sin interfaz.
    logger.warn("locale_load_failed");
  }
  return current;
}

/**
 * Suscripción para `useSyncExternalStore`. La primera suscripción (el primer componente que se
 * monta) dispara la lectura de la preferencia guardada: así la app arranca con el idioma elegido
 * sin que las pruebas unitarias que importan `t()` toquen el disco.
 */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  if (!bootstrapped) {
    bootstrapped = true;
    void loadStoredLocale();
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Idioma vigente, reactivo: el componente se vuelve a pintar al cambiarlo. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** Solo para pruebas: vuelve al estado inicial del módulo. */
export function resetLocaleStoreForTests(): void {
  current = DEFAULT_LOCALE;
  bootstrapped = false;
  listeners.clear();
  setDefaultMoneyLocale(MONEY_LOCALE[DEFAULT_LOCALE]);
}
