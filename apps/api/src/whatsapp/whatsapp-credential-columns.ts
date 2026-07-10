import { createHash } from 'node:crypto';
import { encryptSecret } from '../shared/secret-cipher';

/** Credenciales de Meta que se pueden cargar/editar por canal. `undefined` ⇒ no tocar; `''` ⇒ limpiar. */
export interface CredentialInput {
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  graphVersion?: string;
}

/** Columnas de credenciales de `whatsapp_channel` (solo las presentes en el parche). */
export type CredentialColumns = Partial<{
  accessToken: string | null;
  appSecret: string | null;
  verifyTokenSha256: string | null;
  graphVersion: string | null;
}>;

/**
 * Traduce las credenciales de la frontera a columnas de la tabla: cifra los secretos (AES-256-GCM),
 * hashea el verify token (SHA-256) y normaliza `graphVersion`. Solo incluye las columnas PRESENTES
 * en el parche (`undefined` no se toca); `''` limpia la credencial (null). Función pura: sin I/O.
 */
export function toCredentialColumns(input: CredentialInput): CredentialColumns {
  const cols: CredentialColumns = {};
  if (input.accessToken !== undefined)
    cols.accessToken = input.accessToken
      ? encryptSecret(input.accessToken)
      : null;
  if (input.appSecret !== undefined)
    cols.appSecret = input.appSecret ? encryptSecret(input.appSecret) : null;
  if (input.verifyToken !== undefined)
    cols.verifyTokenSha256 = input.verifyToken
      ? createHash('sha256').update(input.verifyToken).digest('hex')
      : null;
  if (input.graphVersion !== undefined)
    cols.graphVersion = input.graphVersion ? input.graphVersion : null;
  return cols;
}
