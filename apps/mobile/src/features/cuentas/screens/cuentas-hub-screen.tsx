import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Row, Text } from "@preztiaos/ui";

import { can } from "@/core/auth/authorization";
import { useSession } from "@/core/auth/session";
import { useT } from "@/core/i18n";
import { BorrowersScreen } from "@/features/borrowers/screens/borrowers-screen";
import { ClientMovementsScreen } from "@/features/clients/screens/client-movements-screen";
import { MyClientsScreen } from "@/features/clients/screens/my-clients-screen";
import { CollectorsScreen } from "@/features/collectors/screens/collectors-screen";
import { OperationsScreen } from "@/features/operations/screens/operations-screen";
import { PaymentsHubScreen } from "@/features/payments/screens/payments-hub-screen";

type Segment = { key: string; label: string; render: () => ReactNode };

/**
 * Hub de "Clientes" (#3): todo lo referente al cliente bajo una sola pestaña con control
 * segmentado — Clientes (alta/edición), Pagos (con su detalle) y Movimientos (ingresos/egresos
 * que causa cada cliente), más Cobradores/Operación según rol. El segmento activo vive en la URL
 * (`?tab=`), como en Ajustes: recargar o compartir el enlace no pierde el contexto; si la URL
 * pide un segmento no visible, cae al primero permitido.
 */
export function CuentasHubScreen() {
  const { t } = useT();
  const { role } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();

  const segments: Segment[] = [];
  // a) Crear/gestionar clientes.
  if (can(role, "borrower:manage")) {
    segments.push({ key: "clientes", label: t("borrowers.tab"), render: () => <BorrowersScreen /> });
  } else if (can(role, "client:read")) {
    segments.push({ key: "clientes", label: t("clients.tab"), render: () => <MyClientsScreen /> });
  }
  // b) Pagos + detalle completo de cada pago.
  if (can(role, "payment:reconcile") || can(role, "payment:register")) {
    segments.push({ key: "pagos", label: t("payments.title"), render: () => <PaymentsHubScreen /> });
  }
  // c) Movimientos completos por cliente (ingresos/egresos). Vista de gestión (ADMIN/COORDINATOR).
  if (can(role, "payment:reconcile")) {
    segments.push({
      key: "movimientos",
      label: t("clientMovements.tab"),
      render: () => <ClientMovementsScreen />,
    });
  }
  if (can(role, "collector:manage")) {
    segments.push({ key: "cobradores", label: t("collectors.tab"), render: () => <CollectorsScreen /> });
  }
  if (can(role, "borrower:manage")) {
    segments.push({ key: "operacion", label: t("operations.tab"), render: () => <OperationsScreen /> });
  }

  const current = segments.find((s) => s.key === params.tab) ?? segments[0];

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      {segments.length > 1 ? (
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
      ) : null}
      <View className="flex-1">{current?.render()}</View>
    </View>
  );
}
