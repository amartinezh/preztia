import { useEffect, useState } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

/**
 * En web el render estático no conoce el esquema del cliente; se recalcula tras
 * la hidratación para evitar un parpadeo de tema incorrecto.
 */
export function useColorScheme(): "light" | "dark" {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const scheme = useRNColorScheme();
  if (!hydrated) return "light";
  return scheme === "dark" ? "dark" : "light";
}
