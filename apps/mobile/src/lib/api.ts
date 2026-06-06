import { initClient } from "@ts-rest/core";
import { Platform } from "react-native";
import { creditContract } from "@preztiaos/contracts";

// El host depende de dónde corre la app:
// - Web / iOS simulator: localhost llega a tu máquina.
// - Android emulator: localhost es el propio emulador; la máquina es 10.0.2.2.
// - Dispositivo físico: usa la IP LAN de tu máquina (define EXPO_PUBLIC_API_URL).
const defaultBaseUrl =
  Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

export const api = initClient(creditContract, {
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? defaultBaseUrl,
  baseHeaders: {},
});
