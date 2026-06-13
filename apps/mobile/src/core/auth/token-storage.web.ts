/**
 * Almacenamiento del token en WEB.
 *
 * No existe Keychain en el navegador. Lo ideal en producción es una cookie httpOnly
 * gestionada por el backend; mientras el contrato no lo soporte, persistimos en
 * localStorage de forma que la sesión sobreviva a recargas. NUNCA se guardan secretos
 * de servidor aquí (solo el JWT del usuario, que ya es portador de su propia identidad).
 */

const ACCESS_KEY = "preztia.accessToken";
const REFRESH_KEY = "preztia.refreshToken";

export type StoredTokens = { accessToken: string; refreshToken: string | null };

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const tokenStorage = {
  async load(): Promise<StoredTokens | null> {
    const s = storage();
    const accessToken = s?.getItem(ACCESS_KEY) ?? null;
    if (!accessToken) return null;
    return { accessToken, refreshToken: s?.getItem(REFRESH_KEY) ?? null };
  },
  async save(tokens: StoredTokens): Promise<void> {
    const s = storage();
    if (!s) return;
    s.setItem(ACCESS_KEY, tokens.accessToken);
    if (tokens.refreshToken) s.setItem(REFRESH_KEY, tokens.refreshToken);
    else s.removeItem(REFRESH_KEY);
  },
  async clear(): Promise<void> {
    const s = storage();
    s?.removeItem(ACCESS_KEY);
    s?.removeItem(REFRESH_KEY);
  },
};
