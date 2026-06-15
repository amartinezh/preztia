import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { Banner } from "@preztiaos/ui";

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
        <Stack.Screen name="credit/new" options={{ title: t("credit.new.title"), presentation: "modal" }} />
        <Stack.Screen name="credit/[id]" options={{ title: t("credit.list.title") }} />
        <Stack.Screen name="payment/[creditId]" options={{ title: t("payments.register"), presentation: "modal" }} />
        <Stack.Screen name="collectors/[id]" options={{ title: t("collectors.assign.title") }} />
      </Stack>
    </View>
  );
}
