import { type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Container } from "@preztiaos/ui";

type ScreenProps = {
  children: ReactNode;
  /** Envuelve el contenido en scroll (formularios largos). Por defecto activo. */
  scroll?: boolean;
  /** Limita y centra el contenido en pantallas grandes (web/tablet). */
  contained?: boolean;
};

/**
 * Envoltura de pantalla: safe areas (iOS/Android), fondo temático y contenedor responsivo.
 * Vive en la app (no en @preztiaos/ui) porque depende de `react-native-safe-area-context`.
 */
export function Screen({ children, scroll = true, contained = true }: ScreenProps) {
  const body = contained ? <Container className="flex-1 py-4">{children}</Container> : children;
  return (
    <SafeAreaView edges={["top", "bottom"]} className="flex-1 bg-white dark:bg-zinc-950">
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="flex-grow"
          showsVerticalScrollIndicator={false}
        >
          {body}
        </ScrollView>
      ) : (
        <View className="flex-1">{body}</View>
      )}
    </SafeAreaView>
  );
}
