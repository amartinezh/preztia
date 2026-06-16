import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { ApplicationReviewSummary, CreditApplicationStatus } from "@preztiaos/contracts";
import { Badge, Button, EmptyState, ErrorState, ListItem, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useApplicationsList } from "../api/queries";
import { applicationStatusBadge, verdictBadge } from "../components/review-status";

// Las dos operaciones del flujo (#6): "En proceso" = chat de WhatsApp en curso, faltan documentos;
// "Por aprobar" = expediente completo esperando decisión. "Todas" muestra ambas.
type StatusFilter = "ALL" | CreditApplicationStatus;
const FILTERS: { value: StatusFilter; key: "review.filter.all" | "review.section.inProgress" | "review.section.toApprove"; hint?: "review.section.inProgressHint" | "review.section.toApproveHint" }[] = [
  { value: "ALL", key: "review.filter.all" },
  { value: "AWAITING_DOCUMENTS", key: "review.section.inProgress", hint: "review.section.inProgressHint" },
  { value: "IN_REVIEW", key: "review.section.toApprove", hint: "review.section.toApproveHint" },
];

/**
 * Revisión: operación principal del flujo de solicitudes. Lista los expedientes esperando
 * respuesta, separados en "En proceso" y "Por aprobar", y ofrece un acceso aislado a la
 * conversación de WhatsApp del canal. Paginado (§3.7); al tocar una fila se abre el detalle.
 */
export function ApplicationsReviewScreen() {
  const { t } = useT();
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const query = useApplicationsList(filter === "ALL" ? undefined : filter);

  const items = useMemo<ApplicationReviewSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const activeHint = FILTERS.find((f) => f.value === filter)?.hint;

  if (query.isError) {
    return <ErrorState title={t("review.list.title")} description={t("errors.network")} onRetry={() => query.refetch()} />;
  }

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Row className="justify-between">
              <Text variant="subtitle">{t("review.list.title")}</Text>
              <Button
                label={t("review.rejections")}
                variant="ghost"
                size="sm"
                onPress={() => router.push("/rejections" as Href)}
              />
            </Row>

            {/* Acceso aislado a la conversación de WhatsApp del canal (#6). */}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/conversations" as Href)}
              className="min-h-[48px] flex-row items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 active:opacity-80 web:transition-opacity"
            >
              <View className="h-5 w-5 items-center justify-center rounded-full bg-white">
                <Text className="text-xs">💬</Text>
              </View>
              <Text variant="label" tone="inverse" className="text-base">
                {t("review.whatsapp")}
              </Text>
            </Pressable>

            <Row gap="sm" className="flex-wrap">
              {FILTERS.map((f) => {
                const active = filter === f.value;
                return (
                  <Pressable
                    key={f.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setFilter(f.value)}
                    className={`min-h-[36px] justify-center rounded-full border px-3 ${
                      active
                        ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                        : "border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <Text variant="label" tone={active ? "primary" : "muted"}>
                      {t(f.key)}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
            {activeHint ? (
              <Text variant="caption" tone="muted">
                {t(activeHint)}
              </Text>
            ) : null}
          </Stack>
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
          query.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <View className="py-24">
              <EmptyState title={t("review.list.empty")} />
            </View>
          )
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner /> : null}
      />
    </View>
  );
}
