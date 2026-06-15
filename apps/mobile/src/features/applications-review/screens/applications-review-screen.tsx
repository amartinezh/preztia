import { useMemo } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import type { ApplicationReviewSummary } from "@preztiaos/contracts";
import { Badge, EmptyState, ErrorState, ListItem, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useApplicationsList } from "../api/queries";
import { applicationStatusBadge, verdictBadge } from "../components/review-status";

/**
 * Listado de intentos de solicitud para el coordinador: cada fila muestra el solicitante
 * (teléfono enmascarado), el estado del expediente y el veredicto antifraude vigente con su
 * score. Paginado (§3.7). Al tocar una fila se abre el detalle completo.
 */
export function ApplicationsReviewScreen() {
  const { t } = useT();
  const router = useRouter();
  const query = useApplicationsList();

  const items = useMemo<ApplicationReviewSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return <ErrorState title={t("review.list.title")} description={t("errors.network")} onRetry={() => query.refetch()} />;
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Row className="pb-2">
            <Text variant="subtitle">{t("review.list.title")}</Text>
          </Row>
        }
        renderItem={({ item }) => {
          const status = applicationStatusBadge(item.status);
          const verdict = verdictBadge(item.latestVerdictStatus);
          return (
            <ListItem
              title={item.applicantPhoneMasked}
              subtitle={`${item.documentsTotal} doc · ${item.documentsFlagged} marcados`}
              onPress={() => router.push(`/applications/${item.id}` as Href)}
              trailing={
                <Stack gap="xs" className="items-end">
                  <Badge
                    tone={verdict.tone}
                    label={item.latestVerdictScore != null ? `${verdict.label} ${item.latestVerdictScore}` : verdict.label}
                  />
                  <Badge tone={status.tone} label={status.label} />
                </Stack>
              }
            />
          );
        }}
        ListEmptyComponent={
          <View className="py-24">
            <EmptyState title={t("review.list.empty")} />
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
