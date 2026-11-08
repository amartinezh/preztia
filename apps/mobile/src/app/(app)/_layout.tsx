import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { Stack, useRouter, type Href } from "expo-router";
import { Banner, Text, useToast } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useOfflineSync } from "@/core/offline/use-offline-sync";
import { registerCashPaymentExecutor } from "@/features/payments/api/offline-executor";

let executorsRegistered = false;

/** Área autenticada: pestañas como ancla + pantallas de detalle apiladas encima. */
export default function AppLayout() {
  const { t, tf } = useT();
  const toast = useToast();
  // Cada barrido de la cola offline se cuenta a la persona: lo enviado y, sobre todo, lo que el
  // servidor rechazó (un cobro "guardado" que no existe nunca debe pasar en silencio).
  const { pending } = useOfflineSync(({ processed, dropped }) => {
    if (processed > 0) {
      toast.show({ tone: "success", title: t("offline.syncedTitle"), description: tf("offline.syncedBody", { n: processed }) });
    }
    if (dropped > 0) {
      toast.show({ tone: "danger", title: t("offline.droppedTitle"), description: t("offline.droppedBody") });
    }
  });

  useEffect(() => {
    if (!executorsRegistered) {
      registerCashPaymentExecutor();
      executorsRegistered = true;
    }
  }, []);

  // Título + botón "atrás" con fallback para toda pantalla apilada: en web una carga directa de la
  // URL no deja historial y el chevron por defecto no aparece, así que cada pantalla declara a qué
  // ancla volver para no dejar al usuario sin salida. Las pantallas modales también lo llevan.
  const detail = (title: string, fallback: Href, presentation?: "modal") => ({
    title,
    headerLeft: () => <HeaderBack fallback={fallback} />,
    ...(presentation ? { presentation } : {}),
  });

  return (
    <View className="flex-1">
      {pending > 0 ? (
        <View className="px-4 pt-2">
          <Banner
            tone="warning"
            title={t("common.offlineBanner")}
            description={pending === 1 ? t("offline.pendingOne") : tf("offline.pendingMany", { n: pending })}
          />
        </View>
      ) : null}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="conversations" options={detail(t("inbox.title"), "/applications" as Href)} />
        <Stack.Screen name="zones" options={detail(t("zones.tab"), "/settings?tab=zones" as Href)} />
        <Stack.Screen name="users" options={detail(t("users.tab"), "/settings?tab=users" as Href)} />
        <Stack.Screen name="credit/new" options={detail(t("credit.new.title"), "/cartera" as Href, "modal")} />
        <Stack.Screen name="credit/migrate" options={detail(t("migrate.title"), "/cartera" as Href, "modal")} />
        <Stack.Screen name="credit/[id]" options={detail(t("credit.list.title"), "/cartera" as Href)} />
        <Stack.Screen name="payment/[creditId]" options={detail(t("payments.register"), "/" as Href, "modal")} />
        <Stack.Screen name="visit/[creditId]" options={detail(t("visits.detail.title"), "/visitas" as Href)} />
        <Stack.Screen name="collectors/[id]" options={detail(t("collectors.assign.title"), "/cuentas?tab=cobradores" as Href)} />
        <Stack.Screen name="applications/[id]" options={detail(t("review.detail.title"), "/applications" as Href)} />
        <Stack.Screen name="account/[creditId]" options={detail(t("accounts.detail.title"), "/cartera" as Href)} />
        <Stack.Screen name="payment-plans" options={detail(t("plans.tab"), "/settings?tab=plans" as Href)} />
        <Stack.Screen name="rejections" options={detail(t("review.rejections"), "/applications" as Href)} />
        <Stack.Screen name="lists" options={detail(t("lists.title"), "/cuentas" as Href)} />
        <Stack.Screen name="payments/[id]" options={detail(t("payment.detail.title"), "/cuentas?tab=pagos" as Href)} />
        <Stack.Screen name="collection-map" options={detail(t("map.title"), "/cartera" as Href)} />
        <Stack.Screen name="collection-routes" options={detail(t("route.title"), "/cartera" as Href)} />
        <Stack.Screen name="cash/boxes" options={detail(t("cash.boxes.title"), "/cash" as Href)} />
        <Stack.Screen name="cash/movements" options={detail(t("cash.movements.title"), "/cash/boxes" as Href)} />
        <Stack.Screen name="cash/config" options={detail(t("cash.config.link"), "/cash/boxes" as Href)} />
      </Stack>
    </View>
  );
}

/**
 * Botón "atrás" de las pantallas apiladas: vuelve por el historial si existe; si no (carga
 * directa de URL en web), cae al ancla indicada por la pantalla.
 */
function HeaderBack({ fallback }: { fallback: Href }) {
  const { t } = useT();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      hitSlop={8}
      style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
    >
      <Text variant="heading">←</Text>
    </Pressable>
  );
}
