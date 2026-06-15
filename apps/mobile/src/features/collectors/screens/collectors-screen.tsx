import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import type { UserSummary } from "@preztiaos/contracts";
import { Button, EmptyState, ListItem, Row, Spinner, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useUsersList } from "@/features/users/api/queries";
import { CreateUserModal } from "@/features/users/screens/users-screen";

/**
 * Vista del COORDINATOR: sus cobradores. Puede crear uno nuevo y, al tocarlo, asignarle los
 * clientes (deudores) de su alcance que gestionará.
 */
export function CollectorsScreen() {
  const { t } = useT();
  const router = useRouter();
  const query = useUsersList("COLLECTOR");
  const [creating, setCreating] = useState(false);

  const items = useMemo<UserSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner label={t("common.loading")} />;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Row className="justify-between pb-2">
            <Text variant="subtitle">{t("collectors.title")}</Text>
            <Button label={t("common.create")} size="sm" onPress={() => setCreating(true)} />
          </Row>
        }
        ListEmptyComponent={<EmptyState title={t("users.list.empty")} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        renderItem={({ item }) => (
          <ListItem
            title={item.email}
            subtitle={item.zonePaths.join(", ") || "—"}
            onPress={() => router.push(`/collectors/${item.id}` as Href)}
          />
        )}
      />
      <CreateUserModal visible={creating} onClose={() => setCreating(false)} />
    </SafeAreaView>
  );
}
