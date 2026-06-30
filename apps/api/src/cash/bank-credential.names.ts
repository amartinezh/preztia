/**
 * Nombres canónicos de los secretos por proveedor (filas de `bank_credential`). Centralizado
 * para que la escritura (CRUD de cuenta), la lectura (adaptadores) y la presencia en la vista
 * usen las mismas claves, sin literales sueltos.
 */
export const CREDENTIAL_NAME = {
  // Mercado Pago: llave pública (frontend) + token de acceso (backend) + secreto del webhook.
  publicKey: 'public_key',
  accessToken: 'access_token',
  webhookSecret: 'webhook_secret',
} as const;
