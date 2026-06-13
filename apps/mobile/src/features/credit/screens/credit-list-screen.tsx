import { useMemo } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import type { CreditSummary } from "@preztiaos/contracts";
import { Badge, Button, EmptyState, ErrorState, MoneyText, Row, Spinner, Stack, Text, ListItem } from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { useT } from "@/core/i18n";
import { useCreditsList } from "../api/queries";
import { creditStatusBadge } from "../components/credit-status";

export function CreditListScreen() {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const query = useCreditsList();

  const items = useMemo<CreditSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return <ErrorState title={t("credit.list.title")} description={t("errors.network")} onRetry={() => query.refetch()} />;
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Row className="justify-between pb-2">
            <Text variant="subtitle">{t("credit.list.title")}</Text>
            {can(role, "credit:create") ? (
              <Button label={t("credit.new.submit")} size="sm" onPress={() => router.push("/credit/new" as Href)} />
            ) : null}
          </Row>
        }
        renderItem={({ item }) => {
          const badge = creditStatusBadge(item.status);
          return (
            <ListItem
              title={item.borrowerName ?? `Crédito ${item.id.slice(0, 8)}`}
              subtitle={item.zonePath ?? item.zoneId.slice(0, 8)}
              onPress={() => router.push(`/credit/${item.id}` as Href)}
              trailing={
                <Stack gap="xs" className="items-end">
                  <MoneyText variant="label" amountMinor={item.principalMinor} currency={item.currency} />
                  <Badge tone={badge.tone} label={badge.label} />
                </Stack>
              }
            />
          );
        }}
        ListEmptyComponent={
          <View className="py-24">
            <EmptyState title={t("credit.list.empty")} />
          </View>
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner /> : null}
      />
    </SafeAreaView>
  );
}
