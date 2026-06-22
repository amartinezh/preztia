import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { Stack, useRouter, type Href } from "expo-router";
import { Banner, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useOfflineSync } from "@/core/offline/use-offline-sync";
import { registerCashPaymentExecutor } from "@/features/payments/api/offline-executor";

let executorsRegistered = false;

/** Área autenticada: pestañas como ancla + pantallas de detalle apiladas encima. */
export default function AppLayout() {
  const { t } = useT();
  const { pending } = useOfflineSync();

  useEffect(() => {
    if (!executorsRegistered) {
      registerCashPaymentExecutor();
      executorsRegistered = true;
    }
  }, []);

  return (
    <View className="flex-1">
      {pending > 0 ? (
        <View className="px-4 pt-2">
          <Banner tone="warning" title={t("common.offlineBanner")} description={`${pending} pendiente(s)`} />
        </View>
      ) : null}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="conversations" options={{ title: t("inbox.title") }} />
        <Stack.Screen name="zones" options={{ title: t("zones.tab") }} />
        <Stack.Screen name="users" options={{ title: t("users.tab") }} />
        <Stack.Screen name="credit/new" options={{ title: t("credit.new.title"), presentation: "modal" }} />
        <Stack.Screen name="credit/[id]" options={{ title: t("credit.list.title") }} />
        <Stack.Screen name="payment/[creditId]" options={{ title: t("payments.register"), presentation: "modal" }} />
        <Stack.Screen name="collectors/[id]" options={{ title: t("collectors.assign.title") }} />
        <Stack.Screen name="applications/[id]" options={{ title: t("review.detail.title") }} />
        <Stack.Screen
          name="account/[creditId]"
          options={{ title: t("accounts.detail.title"), headerLeft: () => <HeaderBack /> }}
        />
        <Stack.Screen name="payment-plans" options={{ title: t("plans.tab") }} />
        <Stack.Screen name="rejections" options={{ title: t("review.rejections") }} />
        <Stack.Screen name="lists" options={{ title: t("lists.title") }} />
        <Stack.Screen name="payments/[id]" options={{ title: t("payment.detail.title") }} />
      </Stack>
    </View>
  );
}

/**
 * Botón "atrás" del detalle de cuenta: en web una carga directa de la URL no deja
 * historial, así que el chevron por defecto del Stack no aparece. Volvemos al historial
 * si existe; si no, caemos a la Cartera ("/cartera") para no dejar al usuario sin salida.
 */
function HeaderBack() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/cartera" as Href))}
    >
      <Text variant="heading">←</Text>
    </Pressable>
  );
}
