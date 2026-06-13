import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Hashing de contraseñas con scrypt (incluido en node:crypto, sin dependencias
// externas). Formato almacenado: `scrypt:<saltHex>:<hashHex>`.
const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = (await scryptAsync(
    password,
    salt,
    expected.length,
  )) as Buffer;
  // Comparación en tiempo constante para no filtrar información por timing.
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
