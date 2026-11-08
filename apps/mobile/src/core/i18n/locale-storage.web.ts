/**
 * Persistencia de la preferencia de idioma del OPERADOR en WEB (localStorage). Misma interfaz que
 * la variante nativa (`locale-storage.ts`); Metro elige el archivo por plataforma.
 */

const LOCALE_KEY = "preztia.locale";

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Navegador con almacenamiento bloqueado (modo privado estricto): se sigue sin persistir.
    return null;
  }
}

export const localeStorage = {
  async load(): Promise<string | null> {
    return storage()?.getItem(LOCALE_KEY) ?? null;
  },
  async save(locale: string): Promise<void> {
    storage()?.setItem(LOCALE_KEY, locale);
  },
};
