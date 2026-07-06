import { timingSafeEqual } from 'node:crypto';

// Verificación del webhook de PicPay. PicPay NO firma el payload: al configurar la URL de
// notificación en el Painel Lojista genera un TOKEN estático que viaja en el header
// `Authorization` de cada notificación (se muestra una sola vez; aquí vive cifrado en
// `bank_credential` como webhook_secret). La autenticidad se decide comparando ese header con
// el token del tenant en tiempo constante. Defensivo: cualquier dato faltante → false.

export interface PicPayWebhookAuthInput {
  /** Header `Authorization` recibido (puede venir con prefijo `Bearer `). */
  readonly authorizationHeader: string | undefined;
  /** Token de notificación del tenant (descifrado). */
  readonly expectedToken: string;
}

/** ¿La notificación trae el token de webhook correcto del tenant? */
export function verifyPicPayWebhook(input: PicPayWebhookAuthInput): boolean {
  if (!input.expectedToken || !input.authorizationHeader) return false;
  const received = stripBearer(input.authorizationHeader);
  return safeEqual(received, input.expectedToken);
}

/** PicPay envía el token tal cual; se tolera el prefijo `Bearer ` por robustez. */
function stripBearer(header: string): string {
  const trimmed = header.trim();
  return trimmed.toLowerCase().startsWith('bearer ')
    ? trimmed.slice('bearer '.length).trim()
    : trimmed;
}

/** Comparación en tiempo constante; longitudes distintas → false. */
function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
