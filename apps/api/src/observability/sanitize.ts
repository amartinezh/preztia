// Enmascara campos sensibles antes de guardar el cuerpo de la petición en la bitácora (sin
// secretos ni contraseñas en el audit log). Pura: no muta la entrada.
//
// La coincidencia es por SUBCADENA, no por igualdad: `audit_log` es append-only, así que un
// secreto que se filtra aquí NO se puede borrar después. Una lista de nombres exactos deja
// pasar cada campo nuevo que no se acuerde de registrarse (`appSecret`, `verifyToken` y
// `clientSecret` se filtraban en claro por ese motivo); un fragmento cubre las variantes que
// aún no existen. Preferimos enmascarar de más: un campo inocuo oculto no cuesta nada, un
// secreto filtrado es irreversible.
const SENSITIVE_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'apikey',
  'credential',
  'authorization',
] as const;

/** ¿El nombre del campo sugiere que su valor es un secreto? */
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? '***' : sanitize(val);
    }
    return out;
  }
  return value;
}
