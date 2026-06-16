import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { AccountRow } from "@preztiaos/contracts";
import {
  Badge,
  Button,
  Input,
  ListItem,
  minorToMajor,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { csvDownloadAvailable, downloadCsv } from "@/core/export/download-csv";
import { useT } from "@/core/i18n";
import { useExportAccounts } from "@/features/reporting/api/queries";
import { creditStatusBadge } from "@/features/credit/components/credit-status";
import { useAccountsList } from "@/features/accounts/api/queries";

// Filtro de estado de la cartera. "En mora" se resuelve en servidor (onlyOverdue); el resto
// filtra sobre las páginas ya cargadas (la API de cuentas no expone filtro por estado).
type Filter = "ALL" | "ACTIVE" | "SETTLED" | "OVERDUE";
const FILTERS: { value: Filter; key: "cartera.filter.all" | "cartera.filter.active" | "cartera.filter.settled" | "cartera.filter.overdue" }[] = [
  { value: "ALL", key: "cartera.filter.all" },
  { value: "ACTIVE", key: "cartera.filter.active" },
  { value: "OVERDUE", key: "cartera.filter.overdue" },
  { value: "SETTLED", key: "cartera.filter.settled" },
];

/**
 * Cartera unificada (#7): un cliente solicita un crédito; si se aprueba entra aquí. Fusiona la
 * antigua lista de "Créditos" y la vista de "Cuentas" en una sola pantalla con filtros por
 * estado, búsqueda, exportación y alta de crédito. Lee el read-model de cuentas (deuda, cuotas
 * pagas, días de mora). Paginada (§3.7).
 */
export function PortfolioScreen() {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const exportCsv = useExportAccounts();
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");

  const canExport = can(role, "borrower:manage") && csvDownloadAvailable();
  const canCreate = can(role, "credit:create");
  const runExport = () =>
    exportCsv.mutate(undefined, { onSuccess: (res) => downloadCsv(res.filename, res.csv) });

  const query = useAccountsList({
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(filter === "OVERDUE" ? { onlyOverdue: true } : {}),
  });

  const items = useMemo<AccountRow[]>(() => {
    const all = query.data?.pages.flatMap((p) => p.items) ?? [];
    if (filter === "ACTIVE") return all.filter((a) => a.status === "ACTIVE");
    if (filter === "SETTLED") return all.filter((a) => a.status === "SETTLED");
    return all;
  }, [query.data, filter]);

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(a) => a.creditId}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Row className="justify-between">
              <Stack gap="none">
                <Text variant="subtitle">{t("cartera.title")}</Text>
                <Text variant="caption" tone="muted">
                  {t("cartera.subtitle")}
                </Text>
              </Stack>
              <Row gap="sm">
                {canExport ? (
                  <Button
                    label={t("accounts.export")}
                    variant="ghost"
                    size="sm"
                    loading={exportCsv.isPending}
                    onPress={runExport}
                  />
                ) : null}
                {canCreate ? (
                  <Button
                    label={t("cartera.new")}
                    size="sm"
                    onPress={() => router.push("/credit/new" as Href)}
                  />
                ) : null}
              </Row>
            </Row>
            <Input value={name} onChangeText={setName} placeholder={t("accounts.list.search")} />
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
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <Text tone="muted">{t("accounts.list.empty")}</Text>
          )
        }
        renderItem={({ item }) => {
          const badge = creditStatusBadge(item.status);
          return (
            <ListItem
              title={item.borrowerName ?? item.nationalId ?? item.creditId.slice(0, 8)}
              subtitle={`${t("accounts.field.paid")}: ${item.paidCount}/${item.installmentsCount} · ${t("accounts.field.dueToday")}: ${minorToMajor(item.dueTodayMinor)}`}
              onPress={() => router.push(`/account/${item.creditId}` as Href)}
              trailing={
                <Stack gap="xs" className="items-end">
                  <MoneyText
                    variant="label"
                    amountMinor={item.outstandingMinor}
                    currency={item.currency}
                  />
                  {item.daysOverdue > 0 ? (
                    <Badge label={`${item.daysOverdue}d`} tone="danger" />
                  ) : (
                    <Badge label={badge.label} tone={badge.tone} />
                  )}
                </Stack>
              }
            />
          );
        }}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner /> : null}
      />
    </View>
  );
}
