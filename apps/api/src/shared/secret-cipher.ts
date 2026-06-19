import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Cifrado de SECRETOS en columnas de texto (credenciales de API: bancarias y de IA) con
// AES-256-GCM. El valor almacenado es `enc:v1:` + base64(iv || authTag || ciphertext). El
// prefijo versionado permite distinguir un secreto cifrado de uno en texto plano legado:
// `decryptSecret` devuelve tal cual lo que no lleve el prefijo, así la migración es sin
// downtime (lo viejo sigue funcionando; lo que se vuelve a guardar queda cifrado).

const PREFIX = 'enc:v1:';
const IV_BYTES = 12; // recomendado para AES-GCM
const AUTH_TAG_BYTES = 16; // GCM: tag de 128 bits
const KEY_BYTES = 32; // AES-256

/** Cifra un secreto. Cadena vacía/null no aplica (no hay secreto que proteger). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return PREFIX + packed.toString('base64');
}

/**
 * Descifra un secreto producido por `encryptSecret`. Si el valor NO lleva el prefijo
 * versionado, se asume texto plano legado y se devuelve sin cambios (compatibilidad).
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const buffer = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = buffer.subarray(0, IV_BYTES);
  const authTag = buffer.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/** Cifra solo si hay valor; pasa `null` sin tocar (la columna admite NULL). */
export function encryptOptionalSecret(
  value: string | null | undefined,
): string | null {
  return value ? encryptSecret(value) : null;
}

/** Descifra solo si hay valor. */
export function decryptOptionalSecret(
  value: string | null | undefined,
): string | null {
  return value ? decryptSecret(value) : null;
}

function loadKey(): Buffer {
  const raw =
    process.env.SECRETS_ENCRYPTION_KEY ?? process.env.KYC_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY (o KYC_ENCRYPTION_KEY) no configurada: los secretos deben cifrarse en reposo',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `La clave de cifrado de secretos debe ser de ${KEY_BYTES} bytes en base64`,
    );
  }
  return key;
}
