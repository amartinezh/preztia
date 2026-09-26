import { useState } from "react";
import { Pressable } from "react-native";
import type { SettlementConcept, SettlementSnapshot, SettlementView as View } from "@preztiaos/contracts";
import { Badge, Banner, Button, Card, formatMoney, Row, Select, Spinner, Stack, Text } from "@preztiaos/ui";

import { DataTable, type DataRow } from "@/components/data-table";
import { csvDownloadAvailable, downloadCsv } from "@/core/export/download-csv";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashTransactions, type TransactionFilters } from "@/features/cash/api/boxes-queries";
import { fetchLedgerCsv } from "../api/queries";

const PER_MILLE_TO_PERCENT = 10;

// Orden de lectura de la tabla de tesorería: entradas, luego salidas.
const CONCEPT_ORDER: SettlementConcept[] = [
  "COLLECTED",
  "UNIDENTIFIED",
  "TRANSFERS_IN",
  "ADJUSTMENTS_IN",
  "OTHER_IN",
  "DISBURSED",
  "EXPENSES",
  "WITHDRAWALS",
  "TRANSFERS_OUT",
  "ADJUSTMENTS_OUT",
  "DEBT_PAYROLL",
  "DEBT_WRITE_OFF",
  "OTHER_OUT",
];

/** Tasa en base mil como porcentaje legible ("75,0 %"); "—" si no aplica. */
export function perMille(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value / PER_MILLE_TO_PERCENT).toFixed(1)} %`;
}

/**
 * Una liquidación (en curso o fotografía) para dirigir la empresa o la zona: resultado del negocio,
 * tesorería por concepto (cajas o zonas), cobradores con su desempeño y el detalle de movimientos
 * del período con exportación CSV.
 */
export function SettlementView({ view }: { view: View }) {
  const { t } = useT();
  const s = view.snapshot;
  const money = (v: number) => formatMoney(v, view.currency);
  return (
    <Stack gap="lg">
      <Row className="flex-wrap items-center justify-between gap-2">
        <Text variant="heading">
          {view.periodStart} → {view.periodEnd}
        </Text>
        <Badge
          label={view.isOpen ? t("settlement.open") : view.retroactive ? t("settlement.retroactive") : t("settlement.closed")}
          tone={view.isOpen ? "warning" : "success"}
        />
      </Row>
      {view.closedAt ? (
        <Text variant="caption" tone="muted">
          {t("settlement.closedAt")} {new Date(view.closedAt).toLocaleString()}
          {view.closedBy ? "" : ` · ${t("settlement.closedBySystem")}`}
        </Text>
      ) : null}

      <ResultCards snapshot={s} money={money} />

      <Text variant="heading">{t("settlement.treasury")}</Text>
      <TreasuryTable snapshot={s} money={money} />

      <Text variant="heading">{t("settlement.collectors")}</Text>
      <CollectorsTable snapshot={s} money={money} />

      <Text variant="heading">{t("settlement.movements")}</Text>
      <PeriodMovements view={view} money={money} />
    </Stack>
  );
}

function ResultCards({ snapshot, money }: { snapshot: SettlementSnapshot; money: (v: number) => string }) {
  const { t } = useT();
  const r = snapshot.result;
  const tiles: { key: string; label: string; value: string; strong?: boolean }[] = [
    { key: "utility", label: t("settlement.result.utility"), value: money(r.utilityMinor), strong: true },
    { key: "interest", label: t("settlement.result.interest"), value: money(r.interestEarnedMinor) },
    { key: "principal", label: t("settlement.result.principal"), value: money(r.principalRecoveredMinor) },
    { key: "expenses", label: t("settlement.result.expenses"), value: money(r.expensesMinor) },
    { key: "writeOff", label: t("settlement.result.writeOff"), value: money(r.writeOffMinor) },
    { key: "rate", label: t("settlement.result.collectionRate"), value: perMille(r.collectionRatePerMille) },
    { key: "newCredits", label: t("settlement.result.newCredits"), value: `${r.newCreditsCount} · ${money(r.newCreditsPrincipalMinor)}` },
    { key: "overdue", label: t("settlement.result.overdue"), value: money(r.overdueAtCutMinor) },
    { key: "closing", label: t("settlement.result.closing"), value: money(snapshot.totals.closingMinor) },
  ];
  return (
    <Row className="flex-wrap gap-2">
      {tiles.map((tile) => (
        <Card key={tile.key}>
          <Stack gap="xs" className="min-w-[140px]">
            <Text variant="caption" tone="muted">
              {tile.label}
            </Text>
            <Text variant={tile.strong ? "heading" : "label"}>{tile.value}</Text>
          </Stack>
        </Card>
      ))}
    </Row>
  );
}

/** Filas = conceptos; columnas = cajas o zonas (conmutables) + total. Solo conceptos con valor. */
function TreasuryTable({ snapshot, money }: { snapshot: SettlementSnapshot; money: (v: number) => string }) {
  const { t } = useT();
  const [by, setBy] = useState<"boxes" | "zones">("boxes");
  const entities =
    by === "boxes"
      ? snapshot.boxes.map((b) => ({ key: b.cashBoxId, label: b.name, concepts: b.concepts, opening: b.openingMinor, inMinor: b.inMinor, outMinor: b.outMinor, closing: b.closingMinor }))
      : snapshot.zones.map((z) => ({ key: z.zoneId ?? "none", label: z.name ?? t("settlement.noZone"), concepts: z.concepts, opening: null, inMinor: z.inMinor, outMinor: z.outMinor, closing: null }));
  const columns = [...entities.map((e) => ({ key: e.key, label: e.label })), { key: "total", label: t("settlement.total") }];
  const cell = (v: number | null | undefined) => (v === null || v === undefined ? "—" : money(v));
  const totals = snapshot.totals;

  const conceptRows: DataRow[] = CONCEPT_ORDER.filter((c) => (totals.concepts[c] ?? 0) !== 0).map((c) => ({
    key: c,
    label: t(`settlement.concept.${c}`),
    cells: [...entities.map((e) => cell(e.concepts[c] ?? 0)), cell(totals.concepts[c] ?? 0)],
  }));
  const rows: DataRow[] = [
    ...(by === "boxes"
      ? [{ key: "opening", label: t("settlement.opening"), cells: [...entities.map((e) => cell(e.opening)), cell(totals.openingMinor)], strong: true }]
      : []),
    ...conceptRows,
    { key: "in", label: t("settlement.in"), cells: [...entities.map((e) => cell(e.inMinor)), cell(totals.inMinor)], strong: true },
    { key: "out", label: t("settlement.out"), cells: [...entities.map((e) => cell(e.outMinor)), cell(totals.outMinor)], strong: true },
    ...(by === "boxes"
      ? [{ key: "closing", label: t("settlement.closing"), cells: [...entities.map((e) => cell(e.closing)), cell(totals.closingMinor)], strong: true }]
      : []),
  ];

  return (
    <Stack gap="sm">
      <Row gap="sm">
        {(["boxes", "zones"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: by === option }}
            onPress={() => setBy(option)}
            className={`min-h-[36px] justify-center rounded-full border px-3 ${
              by === option ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
            }`}
          >
            <Text variant="caption" tone={by === option ? "primary" : "muted"}>
              {t(`settlement.by.${option}`)}
            </Text>
          </Pressable>
        ))}
      </Row>
      <DataTable columns={columns} rows={rows} empty={t("settlement.empty")} />
    </Stack>
  );
}

function CollectorsTable({ snapshot, money }: { snapshot: SettlementSnapshot; money: (v: number) => string }) {
  const { t } = useT();
  const collectors = snapshot.collectors;
  const columns = collectors.map((c) => ({ key: c.collectorId, label: c.email ?? c.collectorId }));
  const row = (key: string, label: string, pick: (c: (typeof collectors)[number]) => string, strong = false): DataRow => ({
    key,
    label,
    cells: collectors.map(pick),
    strong,
  });
  const rows: DataRow[] = [
    row("collected", t("settlement.collector.collected"), (c) => money(c.collectedMinor)),
    row("expenses", t("settlement.collector.expenses"), (c) => money(c.expensesMinor)),
    row("transferred", t("settlement.collector.transferred"), (c) => money(c.transferredOutMinor)),
    row("payroll", t("settlement.collector.payroll"), (c) => money(c.payrollMinor)),
    row("writeOff", t("settlement.collector.writeOff"), (c) => money(c.writeOffMinor)),
    row("closingCash", t("settlement.collector.closingCash"), (c) => money(c.closingCashMinor), true),
    row("stops", t("settlement.collector.stops"), (c) =>
      c.performance ? `${c.performance.stopsResolved} / ${c.performance.stopsDispatched}` : "—",
    ),
    row("effective", t("settlement.collector.effective"), (c) => perMille(c.performance?.effectiveVisitRatePerMille)),
    row("resolveTime", t("settlement.collector.resolveTime"), (c) =>
      c.performance?.avgResolveMinutes != null ? `${c.performance.avgResolveMinutes} min` : "—",
    ),
    row("deposits", t("settlement.collector.deposits"), (c) =>
      c.performance ? `${c.performance.depositsVerified} / ${c.performance.depositsIssued}` : "—",
    ),
    row("depositTime", t("settlement.collector.depositTime"), (c) =>
      c.performance?.avgDepositReportMinutes != null ? `${c.performance.avgDepositReportMinutes} min` : "—",
    ),
    row("remittances", t("settlement.collector.remittances"), (c) =>
      c.performance ? `${c.performance.remittancesSubmitted}` : "—",
    ),
    row("late", t("settlement.collector.late"), (c) => (c.performance ? `${c.performance.remittancesLate}` : "—")),
  ];
  return <DataTable columns={columns} rows={collectors.length ? rows : []} empty={t("settlement.noCollectors")} />;
}

/** Movimientos exactos del período [inicio, fin), con filtros y exportación CSV. */
function PeriodMovements({ view, money }: { view: View; money: (v: number) => string }) {
  const { t } = useT();
  const [kind, setKind] = useState<TransactionFilters["kind"]>(undefined);
  const [cashBoxId, setCashBoxId] = useState<string | undefined>(undefined);
  const [zoneId, setZoneId] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filters: TransactionFilters = {
    from: view.startsAt,
    before: view.endsAt,
    ...(kind ? { kind } : {}),
    ...(cashBoxId ? { cashBoxId } : {}),
    ...(zoneId ? { zoneId } : {}),
  };
  const list = useCashTransactions(filters);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const ALL = "";
  const kinds: NonNullable<TransactionFilters["kind"]>[] = [
    "PAYMENT_IN", "DISBURSEMENT", "EXPENSE", "WITHDRAWAL", "TRANSFER", "ADJUSTMENT", "UNIDENTIFIED", "DEBT_CLOSURE",
  ];

  const exportCsv = async () => {
    setError(null);
    setExporting(true);
    try {
      const { csv, truncated } = await fetchLedgerCsv(filters);
      downloadCsv(`movimientos-${view.periodStart}.csv`, csv);
      if (truncated) setError(t("settlement.exportTruncated"));
    } catch (err) {
      setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack gap="sm">
      <Row className="flex-wrap gap-2">
        <Select
          value={kind ?? ALL}
          options={[{ value: ALL, label: t("settlement.filter.allKinds") }, ...kinds.map((k) => ({ value: k, label: t(`cash.kind.${k}`) }))]}
          onChange={(v) => setKind((v || undefined) as TransactionFilters["kind"])}
        />
        <Select
          value={cashBoxId ?? ALL}
          options={[{ value: ALL, label: t("settlement.filter.allBoxes") }, ...view.snapshot.boxes.map((b) => ({ value: b.cashBoxId, label: b.name }))]}
          onChange={(v) => setCashBoxId(v || undefined)}
        />
        <Select
          value={zoneId ?? ALL}
          options={[
            { value: ALL, label: t("settlement.filter.allZones") },
            ...view.snapshot.zones.filter((z) => z.zoneId).map((z) => ({ value: z.zoneId!, label: z.name ?? z.zoneId! })),
          ]}
          onChange={(v) => setZoneId(v || undefined)}
        />
        {csvDownloadAvailable() ? (
          <Button label={t("settlement.exportCsv")} variant="secondary" size="sm" loading={exporting} onPress={() => void exportCsv()} />
        ) : null}
      </Row>
      {error ? <Banner tone="warning" title={error} /> : null}
      {list.isPending ? <Spinner label={t("common.loading")} /> : null}
      <DataTable
        columns={[
          { key: "box", label: t("settlement.col.box") },
          { key: "zone", label: t("settlement.col.zone") },
          { key: "kind", label: t("settlement.col.kind") },
          { key: "amount", label: t("settlement.col.amount") },
        ]}
        rows={items.map((m) => ({
          key: m.id,
          label: new Date(m.createdAt).toLocaleString(),
          cells: [m.boxName, m.zoneName ?? "—", t(`cash.kind.${m.kind}`), `${m.direction === "IN" ? "+" : "−"}${money(m.amountMinor)}`],
        }))}
        empty={list.isPending ? undefined : t("settlement.noMovements")}
      />
      {list.hasNextPage ? (
        <Button label={t("common.loadMore")} variant="ghost" loading={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />
      ) : null}
    </Stack>
  );
}
