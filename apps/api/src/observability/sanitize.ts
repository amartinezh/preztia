// Enmascara campos sensibles antes de guardar el cuerpo de la petición en la bitácora (sin
// secretos ni contraseñas en el audit log). Pura: no muta la entrada.
const SENSITIVE = new Set([
  'password',
  'apikey',
  'aiapikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
]);

export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE.has(key.toLowerCase()) ? '***' : sanitize(val);
    }
    return out;
  }
  return value;
}
