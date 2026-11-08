import "@/global.css";

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useColorScheme, View } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary, Spinner, ToastProvider } from "@preztiaos/ui";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { SessionProvider, useSession } from "@/core/auth/session";
import { installZodErrorMap } from "@/core/form/zod-error-map";
import { queryClient } from "@/core/query";
import { logger } from "@/core/logger";

// Los esquemas del contrato no traen mensajes propios: sin esto la validación hablaría en inglés.
installZodErrorMap();

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
          <ErrorBoundary onError={(error) => logger.error("render_crash", {}, { name: error.name })}>
            <ToastProvider>
              <AnimatedSplashOverlay />
              <RootNavigator />
            </ToastProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

/**
 * Decide la navegación según la sesión (patrón `Stack.Protected`): el área autenticada y la
 * pantalla de acceso son mutuamente excluyentes; durante la rehidratación se muestra carga.
 */
function RootNavigator() {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-zinc-950">
        <Spinner />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === "authenticated"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "unauthenticated"}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
