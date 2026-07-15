import { Platform } from "react-native";

/**
 * Configuración por entorno (fuera del código, §3.4). Solo variables `EXPO_PUBLIC_*`
 * son visibles en el cliente; NUNCA se ponen secretos aquí (el bundle es público).
 */

// El host de la API depende de dónde corre la app (ver §14 ARCHITECTURE.md):
// - Web / simulador iOS: localhost es la máquina.
// - Emulador Android: localhost es el emulador; la máquina es 10.0.2.2.
// - Dispositivo físico: define EXPO_PUBLIC_API_URL con la IP LAN.
const DEFAULT_API_URL =
  Platform.OS === "android" ? "http://10.0.2.2:3010" : "http://localhost:3010";

export const env = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL,
  // Header de tenant de PRUEBA: solo se envía si el backend está en modo de pruebas.
  // En producción el tenant se deriva del JWT verificado (no del cliente). Ver §8/§21.
  testTenantId: process.env.EXPO_PUBLIC_TEST_TENANT_ID ?? null,
  requestTimeoutMs: Number(process.env.EXPO_PUBLIC_REQUEST_TIMEOUT_MS ?? 15_000),
} as const;
