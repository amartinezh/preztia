import { useState } from "react";
import { Pressable } from "react-native";
import type { SettlementSummary } from "@preztiaos/contracts";
import { Badge, Banner, Button, Card, ConfirmModal, ErrorState, formatMoney, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { DataTable, type DataRow } from "@/components/data-table";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { formatDayMonth, formatPeriodRange } from "@/core/locale/dates";
import { useCloseSettlement, useCurrentSettlement, useSettlement, useSettlements } from "../api/queries";
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
  const { t, tf } = useT();
  const { role } = useSession();
  const current = useCurrentSettlement();
  const close = useCloseSettlement();
  const [error, setError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  // Sellar el período solo tras confirmar; el error queda en el Banner de la pantalla.
  const confirmClose = () => {
    setError(null);
    close.mutate(undefined, {
      onSettled: () => setConfirmingClose(false),
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  if (current.isPending) return <Spinner label={t("common.loading")} />;
  if (current.isError || !current.data) {
    return (
      <ErrorState
        title={t("errors.unknown")}
        retryLabel={t("common.retry")}
        onRetry={() => void current.refetch()}
      />
    );
  }
  const data = current.data;
  return (
    <Stack gap="md">
      {!data.startDateConfigured ? (
        <Banner tone="info" title={t("settlement.noStartDate")} description={t("settlement.noStartDateHint")} />
      ) : null}
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
          onPress={() => setConfirmingClose(true)}
        />
      ) : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      <SettlementView view={data} />
      {/* El contrato no trae las fechas del período que se va a sellar (la vista "en curso" es el
          período calendario actual); se dice cuál es: el terminado más antiguo sin cerrar. */}
      <ConfirmModal
        visible={confirmingClose}
        title={t("settlement.close.confirmTitle")}
        description={tf("settlement.close.confirmBodyPending", { n: data.pendingClosures })}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        tone="danger"
        loading={close.isPending}
        onConfirm={confirmClose}
        onCancel={() => setConfirmingClose(false)}
      />
    </Stack>
  );
}

function SettlementHistory() {
  const { t, tf, locale } = useT();
  const list = useSettlements();
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = useSettlement(openId);
  // Todos los períodos cargados, del más antiguo al más reciente (lectura de izquierda a derecha);
  // "Cargar más" trae la página siguiente y la tabla crece hacia la izquierda.
  const periods = (list.data?.pages.flatMap((page) => page.items) ?? []).slice().reverse();
  const total = list.data?.pages[0]?.total ?? periods.length;

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
  const range = (p: SettlementSummary) => formatPeriodRange(p.periodStart, p.periodEnd, locale);
  const columnLabel = (p: SettlementSummary) => `${range(p)}${p.retroactive ? " *" : ""}`;
  const hasRetroactive = periods.some((p) => p.retroactive);
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
        periods={periods.map((p) => formatDayMonth(p.periodStart, locale))}
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
        columns={periods.map((p) => ({ key: p.id, label: columnLabel(p), onPress: () => setOpenId(p.id) }))}
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
      {hasRetroactive ? (
        <Text variant="caption" tone="muted">
          {t("settlement.retroactiveMark")}
        </Text>
      ) : null}

      <Text variant="heading">{t("settlement.periods")}</Text>
      <Text variant="caption" tone="muted">
        {t("settlement.periodsHint")}
      </Text>
      <Stack gap="sm">
        {/* Del más reciente al más antiguo: lo último cerrado es lo que dirección busca primero. */}
        {[...periods].reverse().map((p) => (
          <Card key={p.id}>
            <Row className="flex-wrap items-center justify-between gap-2">
              <Stack gap="xs" className="flex-1">
                <Row className="flex-wrap items-center gap-2">
                  <Text variant="label">{range(p)}</Text>
                  {p.retroactive ? <Badge label={t("settlement.retroactive")} tone="warning" /> : null}
                </Row>
                <Text variant="caption" tone="muted">
                  {t("settlement.result.utility")} {money(p.result.utilityMinor)} · {t("settlement.closing")} {money(p.totals.closingMinor)}
                </Text>
              </Stack>
              <Button label={t("settlement.view")} variant="secondary" size="sm" onPress={() => setOpenId(p.id)} />
            </Row>
          </Card>
        ))}
      </Stack>
      <Text variant="caption" tone="muted">
        {tf("settlement.showing", { n: periods.length, total })}
      </Text>
      {list.hasNextPage ? (
        <Button label={t("common.loadMore")} variant="ghost" loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />
      ) : null}
    </Stack>
  );
}
