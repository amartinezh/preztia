import * as SecureStore from "expo-secure-store";

/**
 * Almacenamiento del token en NATIVO (iOS Keychain / Android Keystore vía expo-secure-store).
 * Variante web en `token-storage.web.ts`. Interfaz idéntica en ambas plataformas.
 */

const ACCESS_KEY = "preztia.accessToken";
const REFRESH_KEY = "preztia.refreshToken";

export type StoredTokens = { accessToken: string; refreshToken: string | null };

export const tokenStorage = {
  async load(): Promise<StoredTokens | null> {
    const accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
    if (!accessToken) return null;
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    return { accessToken, refreshToken };
  },
  async save(tokens: StoredTokens): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken);
    if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
