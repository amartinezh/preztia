import { useState } from "react";
import { Pressable } from "react-native";
import type { SettlementSummary } from "@preztiaos/contracts";
import { Banner, Button, ErrorState, formatMoney, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { DataTable, type DataRow } from "@/components/data-table";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCloseSettlement, useCurrentSettlement, useSettlement, useSettlements, HISTORY_PERIODS } from "../api/queries";
import { SettlementView, perMille } from "../components/settlement-view";
import { TrendChart } from "../components/trend-chart";

type Tab = "current" | "history";

/**
 * LIQUIDACIÓN (ADMIN/COORDINATOR, recortada al alcance en el servidor): la en curso ("todo lo que
 * pasó desde la última liquidación") y el histórico de fotografías selladas con su tendencia. El
 * ADMIN cierra los períodos terminados (o los cierra el sistema si el cierre automático está activo).
 */
export function SettlementsScreen() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("current");
  return (
    <Screen>
      <Stack gap="lg">
        <Row gap="sm">
          {(["current", "history"] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              className={`min-h-[40px] justify-center rounded-full border px-4 ${
                tab === key ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
              }`}
            >
              <Text variant="label" tone={tab === key ? "primary" : "muted"}>
                {t(`settlement.tab.${key}`)}
              </Text>
            </Pressable>
          ))}
        </Row>
        {tab === "current" ? <CurrentSettlement /> : <SettlementHistory />}
      </Stack>
    </Screen>
  );
}

function CurrentSettlement() {
  const { t } = useT();
  const { role } = useSession();
  const current = useCurrentSettlement();
  const close = useCloseSettlement();
  const [error, setError] = useState<string | null>(null);

  if (current.isPending) return <Spinner label={t("common.loading")} />;
  if (current.isError || !current.data) {
    return <ErrorState title={t("errors.unknown")} onRetry={() => void current.refetch()} />;
  }
  const data = current.data;
  return (
    <Stack gap="md">
      {data.pendingClosures > 0 ? (
        <Banner
          tone="warning"
          title={t("settlement.pending").replace("{n}", String(data.pendingClosures))}
          description={t("settlement.pendingHint")}
        />
      ) : null}
      {role === "ADMIN" && data.pendingClosures > 0 ? (
        <Button
          label={t("settlement.closeNext")}
          loading={close.isPending}
          onPress={() => {
            setError(null);
            close.mutate(undefined, {
              onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
            });
          }}
        />
      ) : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      <SettlementView view={data} />
    </Stack>
  );
}

function SettlementHistory() {
  const { t } = useT();
  const list = useSettlements();
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = useSettlement(openId);
  // Los últimos N períodos, del más antiguo al más reciente (lectura de izquierda a derecha).
  const periods = [...(list.data?.pages[0]?.items ?? [])].slice(0, HISTORY_PERIODS).reverse();

  if (openId) {
    return (
      <Stack gap="md">
        <Button label={t("settlement.backToHistory")} variant="ghost" onPress={() => setOpenId(null)} />
        {opened.isPending ? <Spinner label={t("common.loading")} /> : null}
        {opened.data ? <SettlementView view={opened.data} /> : null}
      </Stack>
    );
  }
  if (list.isPending) return <Spinner label={t("common.loading")} />;
  if (periods.length === 0) return <Text tone="muted">{t("settlement.noHistory")}</Text>;

  const currency = periods[0]!.currency;
  const money = (v: number) => formatMoney(v, currency);
  const label = (p: SettlementSummary) => p.periodStart.slice(5);
  const row = (key: string, text: string, pick: (p: SettlementSummary) => string, strong = false): DataRow => ({
    key,
    label: text,
    cells: periods.map(pick),
    strong,
  });

  return (
    <Stack gap="md">
      <Text variant="heading">{t("settlement.trend")}</Text>
      <TrendChart
        currency={currency}
        periods={periods.map(label)}
        series={[
          { key: "collected", label: t("settlement.concept.COLLECTED"), values: periods.map((p) => p.totals.concepts.COLLECTED ?? 0) },
          { key: "disbursed", label: t("settlement.concept.DISBURSED"), values: periods.map((p) => p.totals.concepts.DISBURSED ?? 0) },
          { key: "utility", label: t("settlement.result.utility"), values: periods.map((p) => p.result.utilityMinor) },
        ]}
      />
      <Text variant="heading">{t("settlement.comparison")}</Text>
      <Text variant="caption" tone="muted">
        {t("settlement.comparisonHint")}
      </Text>
      <DataTable
        columns={periods.map((p) => ({ key: p.id, label: `${label(p)}${p.retroactive ? " *" : ""}`, onPress: () => setOpenId(p.id) }))}
        rows={[
          row("opening", t("settlement.opening"), (p) => money(p.totals.openingMinor)),
          row("in", t("settlement.in"), (p) => money(p.totals.inMinor)),
          row("out", t("settlement.out"), (p) => money(p.totals.outMinor)),
          row("closing", t("settlement.closing"), (p) => money(p.totals.closingMinor), true),
          row("collected", t("settlement.concept.COLLECTED"), (p) => money(p.totals.concepts.COLLECTED ?? 0)),
          row("disbursed", t("settlement.concept.DISBURSED"), (p) => money(p.totals.concepts.DISBURSED ?? 0)),
          row("interest", t("settlement.result.interest"), (p) => money(p.result.interestEarnedMinor)),
          row("expenses", t("settlement.result.expenses"), (p) => money(p.result.expensesMinor)),
          row("writeOff", t("settlement.result.writeOff"), (p) => money(p.result.writeOffMinor)),
          row("utility", t("settlement.result.utility"), (p) => money(p.result.utilityMinor), true),
          row("rate", t("settlement.result.collectionRate"), (p) => perMille(p.result.collectionRatePerMille)),
          row("newCredits", t("settlement.result.newCredits"), (p) => String(p.result.newCreditsCount)),
          row("overdue", t("settlement.result.overdue"), (p) => money(p.result.overdueAtCutMinor)),
        ]}
      />
    </Stack>
  );
}
