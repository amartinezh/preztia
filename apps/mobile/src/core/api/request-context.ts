/**
 * Contexto síncrono por petición.
 *
 * `@ts-rest/core` no permite pasar metadatos arbitrarios (como la `Idempotency-Key`) por
 * la llamada tipada. Esta utilidad fija opciones justo ANTES de invocar al cliente; el
 * fetcher las consume de forma SÍNCRONA al entrar (antes de cualquier `await`), por lo que
 * es segura incluso con llamadas concurrentes: cada invocación cliente→fetcher es síncrona
 * e ininterrumpida hasta capturar el contexto en una variable local.
 */

export type RequestOptions = {
  /** Clave de idempotencia estable para operaciones de dinero (§3.7). */
  idempotencyKey?: string;
};

let pending: RequestOptions | null = null;

/** Consume (lee y limpia) las opciones de la petición en curso. */
export function takeRequestOptions(): RequestOptions {
  const opts = pending ?? {};
  pending = null;
  return opts;
}

/**
 * Ejecuta `call` con las opciones dadas disponibles para el fetcher. `call` debe disparar
 * la petición de forma síncrona (devolviendo la promesa del cliente ts-rest).
 */
export function withRequestOptions<T>(options: RequestOptions, call: () => Promise<T>): Promise<T> {
  // El fetcher consume `pending` de forma síncrona al iniciar la petición (antes de
  // cualquier await), por lo que no se limpia aquí para no borrarlo antes de tiempo.
  pending = options;
  return call();
}
