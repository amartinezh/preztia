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
  // PicPay: credenciales OAuth2 (client_credentials). El token del webhook de PicPay (header
  // Authorization que PicPay genera en el Painel Lojista) se guarda como `webhook_secret`.
  clientId: 'client_id',
  clientSecret: 'client_secret',
} as const;
