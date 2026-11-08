import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persistencia de la preferencia de idioma del OPERADOR en NATIVO. No es un secreto, así que va a
 * AsyncStorage y no al Keychain. Variante web en `locale-storage.web.ts`; interfaz idéntica.
 */

const LOCALE_KEY = "preztia.locale";

export const localeStorage = {
  async load(): Promise<string | null> {
    return AsyncStorage.getItem(LOCALE_KEY);
  },
  async save(locale: string): Promise<void> {
    await AsyncStorage.setItem(LOCALE_KEY, locale);
  },
};
