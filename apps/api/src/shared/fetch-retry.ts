import { setTimeout as sleep } from 'node:timers/promises';

// Estados HTTP transitorios de un servicio externo: tiene sentido reintentar
// (sobrecarga/indisponibilidad temporal o rate limit), no así 4xx de cliente.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryOptions {
  /** Número total de intentos (incluye el primero). */
  readonly attempts?: number;
  /** Retraso base en ms para el backoff exponencial. */
  readonly baseDelayMs?: number;
}

/**
 * `fetch` con reintentos y backoff exponencial + jitter para fallos transitorios.
 * Devuelve la última respuesta (el llamador decide qué hacer si sigue sin ser OK).
 * No reintenta errores de cliente (4xx salvo 408/429): esos no se arreglan reintentando.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 800;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const isLast = attempt === attempts - 1;
    try {
      const res = await fetch(url, init);
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || isLast) return res;
    } catch (err) {
      // Errores de red (DNS/conexión) también son transitorios: reintentar salvo el último.
      lastError = err;
      if (isLast) throw err;
    }
    // Backoff exponencial con jitter para no sincronizar reintentos.
    await sleep(baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs);
  }
  // Inalcanzable: el bucle siempre retorna o lanza en el último intento.
  throw lastError ?? new Error('fetchWithRetry agotó los intentos');
}
