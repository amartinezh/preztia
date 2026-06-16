import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Row, Text } from "@preztiaos/ui";

import { can } from "@/core/auth/authorization";
import { useSession } from "@/core/auth/session";
import { useT } from "@/core/i18n";
import { BorrowersScreen } from "@/features/borrowers/screens/borrowers-screen";
import { MyClientsScreen } from "@/features/clients/screens/my-clients-screen";
import { CollectorsScreen } from "@/features/collectors/screens/collectors-screen";
import { OperationsScreen } from "@/features/operations/screens/operations-screen";
import { PaymentsHubScreen } from "@/features/payments/screens/payments-hub-screen";

type Segment = { key: string; label: string; render: () => ReactNode };

/**
 * Hub de "Cuentas" (#4): agrupa la gestión de Clientes y Pagos (y Cobradores/Operación según
 * rol) bajo una sola pestaña con un control segmentado, en lugar de varias pestañas sueltas.
 */
export function CuentasHubScreen() {
  const { t } = useT();
  const { role } = useSession();

  const segments: Segment[] = [];
  if (can(role, "borrower:manage")) {
    segments.push({ key: "clientes", label: t("borrowers.tab"), render: () => <BorrowersScreen /> });
  } else if (can(role, "client:read")) {
    segments.push({ key: "clientes", label: t("clients.tab"), render: () => <MyClientsScreen /> });
  }
  if (can(role, "payment:reconcile") || can(role, "payment:register")) {
    segments.push({ key: "pagos", label: t("payments.title"), render: () => <PaymentsHubScreen /> });
  }
  if (can(role, "collector:manage")) {
    segments.push({ key: "cobradores", label: t("collectors.tab"), render: () => <CollectorsScreen /> });
  }
  if (can(role, "borrower:manage")) {
    segments.push({ key: "operacion", label: t("operations.tab"), render: () => <OperationsScreen /> });
  }

  const [active, setActive] = useState(0);
  const current = segments[active] ?? segments[0];

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      {segments.length > 1 ? (
        <View className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row gap="sm">
              {segments.map((s, i) => {
                const isActive = i === active;
                return (
                  <Pressable
                    key={s.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => setActive(i)}
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
