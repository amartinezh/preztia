import { useMemo } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CollectorClient } from "@preztiaos/contracts";
import { EmptyState, ListItem, Row, Spinner, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useMyClients } from "../api/queries";

/** Vista del COBRADOR: solo los clientes que le asignó su coordinador. */
export function MyClientsScreen() {
  const { t } = useT();
  const query = useMyClients();
  const items = useMemo<CollectorClient[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner label={t("common.loading")} />;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(c) => c.borrowerId}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Row className="pb-2">
            <Text variant="subtitle">{t("clients.list.title")}</Text>
          </Row>
        }
        ListEmptyComponent={<EmptyState title={t("clients.list.empty")} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        renderItem={({ item }) => (
          <ListItem
            title={item.name ?? `Cliente ${item.borrowerId.slice(0, 8)}`}
            subtitle={item.phone ?? item.zonePath ?? item.borrowerId.slice(0, 8)}
          />
        )}
      />
    </SafeAreaView>
  );
}
