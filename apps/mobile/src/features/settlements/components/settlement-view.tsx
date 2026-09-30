import { useState } from "react";
import { Pressable } from "react-native";
import type {
  CollectorCommission,
  SettlementConcept,
  SettlementSnapshot,
  SettlementView as View,
} from "@preztiaos/contracts";
import { Badge, Banner, Button, Card, formatMoney, Row, Select, Spinner, Stack, Text } from "@preztiaos/ui";

import { DataTable, type DataRow } from "@/components/data-table";
import { csvDownloadAvailable, downloadCsv } from "@/core/export/download-csv";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashTransactions, type TransactionFilters } from "@/features/cash/api/boxes-queries";
import { fetchLedgerCsv } from "../api/queries";
import { CommissionPayModal, type CommissionPayee } from "./commission-pay-modal";

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
  "COMMISSIONS",
  "OTHER_OUT",
];

/**
 * ¿Esta liquidación tiene comisiones que mostrar? Solo si se causó alguna (estaban encendidas al
 * calcularla) o ya se pagó alguna. Apagadas, la vista queda como antes de existir las comisiones.
 */
function hasCommissions(view: View): boolean {
  return view.snapshot.collectors.some((c) => c.commission != null) || view.commissionPayments.length > 0;
}

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
  const withCommissions = hasCommissions(view);
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

      <ResultCards snapshot={s} money={money} withCommissions={withCommissions} />

      <Text variant="heading">{t("settlement.treasury")}</Text>
      <TreasuryTable snapshot={s} money={money} />

      <Text variant="heading">{t("settlement.collectors")}</Text>
      <CollectorsTable snapshot={s} money={money} withCommissions={withCommissions} />

      {withCommissions ? (
        <>
          <Text variant="heading">{t("settlement.commissions.title")}</Text>
          <CommissionsSection view={view} money={money} />
        </>
      ) : null}

      <Text variant="heading">{t("settlement.movements")}</Text>
      <PeriodMovements view={view} money={money} />
    </Stack>
  );
}

function ResultCards({
  snapshot,
  money,
  withCommissions,
}: {
  snapshot: SettlementSnapshot;
  money: (v: number) => string;
  withCommissions: boolean;
}) {
  const { t } = useT();
  const r = snapshot.result;
  const tiles: { key: string; label: string; value: string; strong?: boolean }[] = [
    { key: "utility", label: t("settlement.result.utility"), value: money(r.utilityMinor), strong: true },
    { key: "interest", label: t("settlement.result.interest"), value: money(r.interestEarnedMinor) },
    { key: "principal", label: t("settlement.result.principal"), value: money(r.principalRecoveredMinor) },
    { key: "expenses", label: t("settlement.result.expenses"), value: money(r.expensesMinor) },
    { key: "writeOff", label: t("settlement.result.writeOff"), value: money(r.writeOffMinor) },
    ...(withCommissions
      ? [{ key: "commissions", label: t("settlement.result.commissions"), value: money(r.commissionsMinor ?? 0) }]
      : []),
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

function CollectorsTable({
  snapshot,
  money,
  withCommissions,
}: {
  snapshot: SettlementSnapshot;
  money: (v: number) => string;
  withCommissions: boolean;
}) {
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
    ...(withCommissions
      ? [
          row("commissionBase", t("settlement.collector.commissionBase"), (c) =>
            c.commission ? `${money(c.commission.baseAmountMinor)} · ${t(`commission.base.short.${c.commission.base}`)}` : "—",
          ),
          row("commission", t("settlement.collector.commission"), (c) => (c.commission ? money(c.commission.amountMinor) : "—"), true),
        ]
      : []),
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

/** Porcentaje y base aplicados ("5,0 % de lo cobrado"), marcando si el tope los recortó. */
function commissionRule(c: CollectorCommission, t: ReturnType<typeof useT>["t"]): string {
  const rule = `${perMille(c.ratePerMille)} · ${t(`commission.base.short.${c.base}`)}`;
  return c.cappedByLimit ? `${rule} (${t("settlement.commissions.capped")})` : rule;
}

/**
 * Comisión causada por cobrador y su pago. En el período abierto es un estimado en vivo; al cerrar
 * queda sellada y se paga una vez desde la caja elegida (el pago es un egreso del libro de cajas).
 */
function CommissionsSection({ view, money }: { view: View; money: (v: number) => string }) {
  const { t } = useT();
  const [payee, setPayee] = useState<CommissionPayee | null>(null);
  const paidBy = new Map(view.commissionPayments.map((p) => [p.collectorId, p]));
  return (
    <Stack gap="sm">
      <Text variant="caption" tone="muted">
        {view.isOpen ? t("settlement.commissions.openHint") : t("settlement.commissions.hint")}
      </Text>
      {view.snapshot.collectors.map((c) => {
        const commission = c.commission;
        const payment = paidBy.get(c.collectorId);
        const label = c.email ?? c.collectorId;
        const payable = !view.isOpen && view.id !== null && !payment && (commission?.amountMinor ?? 0) > 0;
        return (
          <Card key={c.collectorId}>
            <Row className="flex-wrap items-center justify-between gap-2">
              <Stack gap="xs" className="flex-1">
                <Text variant="label">{label}</Text>
                <Text variant="caption" tone="muted">
                  {commission ? commissionRule(commission, t) : t("settlement.commissions.none")}
                </Text>
                {payment ? (
                  <Text variant="caption" tone="muted">
                    {t("settlement.commissions.paidFrom")} {payment.cashBoxName} · {new Date(payment.paidAt).toLocaleString()}
                  </Text>
                ) : null}
              </Stack>
              <Text variant="label">{money(commission?.amountMinor ?? 0)}</Text>
              {payment ? (
                <Badge label={t("settlement.commissions.paid")} tone="success" />
              ) : payable ? (
                <Button
                  label={t("settlement.commissions.pay")}
                  size="sm"
                  onPress={() =>
                    setPayee({ collectorId: c.collectorId, label, zoneId: c.zoneId ?? null, amountMinor: commission!.amountMinor })
                  }
                />
              ) : null}
            </Row>
          </Card>
        );
      })}
      {payee && view.id ? (
        <CommissionPayModal settlementId={view.id} payee={payee} currency={view.currency} onClose={() => setPayee(null)} />
      ) : null}
    </Stack>
  );
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
    "PAYMENT_IN", "DISBURSEMENT", "EXPENSE", "WITHDRAWAL", "TRANSFER", "ADJUSTMENT", "UNIDENTIFIED", "DEBT_CLOSURE", "COMMISSION",
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
