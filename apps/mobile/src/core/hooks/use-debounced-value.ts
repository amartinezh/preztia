import { useEffect, useState } from "react";

/** Espera por defecto antes de mandar al servidor lo que la persona teclea. */
export const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Devuelve `value` con retardo: solo cambia cuando la persona deja de teclear `delayMs`. Evita una
 * petición por pulsación en los buscadores que consultan al servidor.
 */
export function useDebouncedValue<T>(value: T, delayMs = DEFAULT_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
