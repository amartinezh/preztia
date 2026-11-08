import { useMemo, useState } from "react";
import { FlatList, Linking, Pressable, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { CollectionTodayItem, CollectionTodayStatus, CollectionTodaySummary } from "@preztiaos/contracts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatMoney,
  Input,
  MoneyText,
  Row,
  Skeleton,
  Stack,
  Text,
} from "@preztiaos/ui";

import { useDebouncedValue } from "@/core/hooks/use-debounced-value";
import { useT, type MessageKey } from "@/core/i18n";
import { usePendingPaymentsByCredit } from "@/core/offline/use-offline-operations";
import { useCollectionToday } from "../api/today-queries";

type Filter = "PENDING" | "PAID_TODAY" | "UP_TO_DATE" | "ALL";
const FILTERS: { value: Filter; key: MessageKey }[] = [
  { value: "PENDING", key: "today.filter.pending" },
  { value: "PAID_TODAY", key: "today.filter.paid" },
  { value: "UP_TO_DATE", key: "today.filter.upToDate" },
  { value: "ALL", key: "today.filter.all" },
];

/**
 * MIS COBROS DE HOY: la lista operativa del cobrador. Todos sus clientes (no solo los en mora), con
 * lo que debe cobrar hoy, lo que ya cobró y el saldo; "Cobrar" abre el abono en un toque. Es el
 * camino que faltaba para abonarle al cliente al día (hallazgo C1 del informe de usabilidad).
 */
export function CollectionTodayScreen() {
  const { t, tf, locale } = useT();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const [filter, setFilter] = useState<Filter>("PENDING");
  // Abonos tomados sin señal (o rechazados) que el servidor aún no refleja: se marcan en la fila.
  const offlineByCredit = usePendingPaymentsByCredit();

  const query = useCollectionToday({
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(filter === "ALL" ? {} : { status: filter }),
  });
  const items = useMemo<CollectionTodayItem[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const first = query.data?.pages[0];
  const filtered = debouncedSearch !== "" || filter !== "ALL";

  const openDetail = (item: CollectionTodayItem) => {
    const qs = [
      `name=${encodeURIComponent(item.borrowerName)}`,
      `overdue=${item.overdueCount}`,
      `days=${item.daysOverdue}`,
      `outstanding=${item.outstandingMinor}`,
      `currency=${encodeURIComponent(item.currency)}`,
      `phone=${encodeURIComponent(item.phone ?? "")}`,
    ].join("&");
    router.push(`/visit/${item.creditId}?${qs}` as Href);
  };

  if (query.isError) {
    return (
      <ErrorState
        title={t("common.loadFailed")}
        description={t("common.loadFailedHint")}
        retryLabel={t("common.retry")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(item) => item.creditId}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListHeaderComponent={
          <Stack gap="md" className="pb-2">
            <Stack gap="none">
              <Text variant="subtitle">{t("today.title")}</Text>
              {first ? (
                <Text variant="caption" tone="muted">
                  {tf("today.date", { date: humanDate(first.date, locale) })}
                </Text>
              ) : null}
            </Stack>

            {first ? (
              <TodaySummaryCard summary={first.summary} currency={first.currency} />
            ) : query.isPending ? (
              <Skeleton className="h-28 w-full rounded-2xl" />
            ) : null}

            <Input
              value={search}
              onChangeText={setSearch}
              placeholder={t("today.search")}
              accessibilityLabel={t("today.search")}
              autoCapitalize="none"
              returnKeyType="search"
            />

            <Row gap="sm" className="flex-wrap">
              {FILTERS.map((f) => {
                const active = filter === f.value;
                return (
                  <Pressable
                    key={f.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setFilter(f.value)}
                    className={`min-h-[44px] justify-center rounded-full border px-4 ${
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
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? (
            <Stack gap="sm">
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-20 w-full rounded-2xl" />
            </Stack>
          ) : (
            <View className="py-10">
              <EmptyState
                title={
                  first && first.summary.clientsCount === 0
                    ? t("today.empty.noClients")
                    : filter === "PENDING" && !debouncedSearch
                      ? t("today.allDone")
                      : t("today.empty.filtered")
                }
                {...(filtered && first && first.summary.clientsCount > 0
                  ? { action: { label: t("today.filter.all"), onPress: () => { setFilter("ALL"); setSearch(""); } } }
                  : {})}
              />
            </View>
          )
        }
        renderItem={({ item }) => (
          <TodayRow
            item={item}
            offline={offlineByCredit.get(item.creditId)}
            onOpen={() => openDetail(item)}
            onCollect={() => router.push(`/payment/${item.creditId}` as Href)}
          />
        )}
        ListFooterComponent={query.isFetchingNextPage ? <Skeleton className="h-16 w-full rounded-2xl" /> : null}
      />
    </View>
  );
}

/** Cobrado hoy frente a lo esperado, con barra de avance y los conteos de la cartera. */
export function TodaySummaryCard({ summary, currency }: { summary: CollectionTodaySummary; currency: string }) {
  const { t, tf } = useT();
  const progress = summary.expectedMinor > 0 ? Math.min(1, summary.collectedMinor / summary.expectedMinor) : 1;
  return (
    <Card>
      <Stack gap="sm">
        <Text variant="caption" tone="muted">
          {t("today.summary.collected")}
        </Text>
        <Row className="items-end justify-between">
          <MoneyText variant="title" amountMinor={summary.collectedMinor} currency={currency} />
          <Text variant="caption" tone="muted">
            {tf("today.summary.expected", { amount: formatMoney(summary.expectedMinor, currency) })}
          </Text>
        </Row>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
          className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        >
          <View className="h-2 rounded-full bg-emerald-600" style={{ width: `${Math.round(progress * 100)}%` }} />
        </View>
        <Row gap="sm" className="flex-wrap">
          <Badge tone={summary.pendingCount > 0 ? "warning" : "success"} label={tf("today.summary.pending", { n: summary.pendingCount })} />
          <Badge tone="success" label={tf("today.summary.paid", { n: summary.paidCount })} />
          <Badge tone="neutral" label={tf("today.summary.clients", { n: summary.clientsCount })} />
        </Row>
      </Stack>
    </Card>
  );
}

/** Fila de cliente: estado del cobro de hoy a la izquierda, "Cobrar" a la derecha (hermanos, no anidados). */
function TodayRow({
  item,
  offline,
  onOpen,
  onCollect,
}: {
  item: CollectionTodayItem;
  offline?: { pending: number; failed: number };
  onOpen: () => void;
  onCollect: () => void;
}) {
  const { t, tf } = useT();
  const money = (minor: number) => formatMoney(minor, item.currency);
  const line = statusLine(item, { t, tf, money });
  return (
    <Row className="items-stretch gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.borrowerName}. ${line.text}`}
        onPress={onOpen}
        className="flex-1 justify-center rounded-xl border border-zinc-200 bg-white p-3 active:opacity-70 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <Stack gap="xs">
          <Row className="items-center gap-2">
            <StatusDot status={item.status} />
            <Text variant="label" className="flex-1 text-base" numberOfLines={1}>
              {item.borrowerName || item.nationalId || item.creditId.slice(0, 8)}
            </Text>
          </Row>
          <Text variant="caption" tone={line.tone}>
            {line.text}
          </Text>
          <Text variant="caption" tone="muted">
            {tf("today.row.outstanding", { amount: money(item.outstandingMinor) })}
            {item.phone ? ` · ${item.phone}` : ""}
          </Text>
          <Row gap="sm" className="flex-wrap">
            {item.openRouteStopId ? <Badge tone="info" label={t("today.row.routeStop")} /> : null}
            {offline && offline.pending > 0 ? <Badge tone="warning" label={t("today.row.pendingSync")} /> : null}
            {offline && offline.failed > 0 ? <Badge tone="danger" label={t("today.row.failedSync")} /> : null}
          </Row>
        </Stack>
      </Pressable>
      <Stack gap="xs" className="justify-center">
        <Button label={t("today.collect")} size="sm" onPress={onCollect} />
        {item.phone ? (
          <Button
            label={t("route.mine.call")}
            variant="ghost"
            size="sm"
            onPress={() => void Linking.openURL(`tel:${item.phone}`)}
          />
        ) : null}
      </Stack>
    </Row>
  );
}

function statusLine(
  item: CollectionTodayItem,
  deps: { t: (k: MessageKey) => string; tf: (k: MessageKey, v: Record<string, string | number>) => string; money: (m: number) => string },
): { text: string; tone: "danger" | "success" | "muted" | "default" } {
  if (item.status === "PENDING") {
    const due = deps.tf("today.row.dueToday", { amount: deps.money(item.dueTodayMinor) });
    if (item.overdueCount > 0) {
      return {
        text: `${due} · ${deps.tf("today.row.overdue", { n: item.overdueCount, d: item.daysOverdue })}`,
        tone: "danger",
      };
    }
    return { text: due, tone: "default" };
  }
  if (item.status === "PAID_TODAY") {
    return { text: deps.tf("today.row.paidToday", { amount: deps.money(item.paidTodayMinor) }), tone: "success" };
  }
  return { text: deps.t("today.row.upToDate"), tone: "muted" };
}

// Semáforo del cobro: rojo debe hoy (con mora), ámbar debe hoy (al día hasta ayer), verde cobrado/al día.
const DOT: Record<CollectionTodayStatus, string> = {
  PENDING: "bg-amber-500",
  PAID_TODAY: "bg-emerald-600",
  UP_TO_DATE: "bg-zinc-300 dark:bg-zinc-600",
};

function StatusDot({ status }: { status: CollectionTodayStatus }) {
  return <View className={`h-2.5 w-2.5 rounded-full ${DOT[status]}`} />;
}

function humanDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}
