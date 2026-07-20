import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Row, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { CashScreen } from "./cash-screen";
import { CashBoxesScreen } from "./cash-boxes-screen";
import { CashMovementsScreen } from "./cash-movements-screen";

type Segment = { key: string; label: string; render: () => ReactNode };

/**
 * Hub de "Dinero" (#2): aglutina TODO lo financiero bajo una sola pestaña con un control
 * segmentado, para que no quede disperso en rutas anidadas. Reúne el Resumen de tesorería
 * (liquidez, reporte diario, gastos), las Cajas y cuentas (saldos, arqueo, conciliación) y el
 * libro global de Movimientos. El segmento activo vive en la URL (`?tab=`), como en Clientes y
 * Ajustes: recargar o compartir el enlace no pierde el contexto.
 */
export function DineroHubScreen() {
  const { t } = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();

  const segments: Segment[] = [
    {
      key: "resumen",
      label: t("dinero.segment.summary"),
      render: () => (
        <CashScreen embedded onOpenBoxes={() => router.setParams({ tab: "cajas" })} />
      ),
    },
    {
      key: "cajas",
      label: t("dinero.segment.boxes"),
      render: () => <CashBoxesScreen embedded />,
    },
    {
      key: "movimientos",
      label: t("dinero.segment.movements"),
      render: () => <CashMovementsScreen />,
    },
  ];

  const current = segments.find((s) => s.key === params.tab) ?? segments[0];

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      <View className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row gap="sm">
            {segments.map((s) => {
              const isActive = s.key === current?.key;
              return (
                <Pressable
                  key={s.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  onPress={() => router.setParams({ tab: s.key })}
                  className={`min-h-[40px] justify-center rounded-full border px-4 ${
                    isActive
                      ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                      : "border-zinc-200 dark:border-zinc-700"
                  }`}
                >
                  <Text variant="label" tone={isActive ? "primary" : "muted"}>
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>
      </View>
      <View className="flex-1">{current?.render()}</View>
    </View>
  );
}
