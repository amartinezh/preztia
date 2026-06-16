import { useMemo } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RejectionSummary } from "@preztiaos/contracts";
import { ListItem, Row, Spinner, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useRejections } from "../api/queries";

/** Histórico de rechazos de solicitudes (motivo + cuándo), scopeado por zona. */
export function RejectionsScreen() {
  const { t } = useT();
  const query = useRejections();
  const items = useMemo<RejectionSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <Row className="pb-2">
            <Text variant="subtitle">{t("review.rejections.title")}</Text>
          </Row>
        }
        ListEmptyComponent={
          query.isPending ? <Spinner label={t("common.loading")} /> : <Text tone="muted">{t("review.rejections.empty")}</Text>
        }
        renderItem={({ item }) => (
          <ListItem
            title={item.applicantPhoneMasked}
            subtitle={`${item.reason} · ${new Date(item.createdAt).toLocaleDateString()}`}
          />
        )}
      />
    </SafeAreaView>
  );
}
