import type {
  RemittanceObligationStatus,
  RemittanceSummary,
  RemittanceView,
} from "@preztiaos/contracts";
import { Badge, Card, MoneyText, Row, Stack, Text, type BadgeTone } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

const MINUTES_PER_HOUR = 60;

const STATUS_TONE: Record<RemittanceObligationStatus, BadgeTone> = {
  UP_TO_DATE: "success",
  PENDING: "warning",
  LATE: "danger",
  AWAITING_RECEPTION: "neutral",
};

/** Atraso legible: "2 h 30 min" / "45 min". */
export function formatLag(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

/** Estado de la obligación de rendir, con el atraso o la hora límite. */
export function ObligationBadge({
  status,
  lateMinutes,
  dueAt,
}: {
  status: RemittanceObligationStatus;
  lateMinutes: number;
  dueAt: string | null;
}) {
  const { t } = useT();
  const detail =
    status === "LATE"
      ? ` · ${formatLag(lateMinutes)}`
      : status === "PENDING" && dueAt
        ? ` · ${t("remittance.dueAt")} ${new Date(dueAt).toLocaleString()}`
        : "";
  return <Badge label={`${t(`remittance.status.${status}`)}${detail}`} tone={STATUS_TONE[status]} />;
}

function Line({
  label,
  amountMinor,
  currency,
  strong = false,
}: {
  label: string;
  amountMinor: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <Row className="items-center justify-between">
      <Text variant={strong ? "label" : "body"} tone={strong ? "default" : "muted"}>
        {label}
      </Text>
      <MoneyText variant={strong ? "label" : "body"} amountMinor={amountMinor} currency={currency} />
    </Row>
  );
}

/** "Recogí X, gasté Y, entrego Z": el resumen del corte, con solo las líneas que tienen valor. */
export function RemittanceSummaryCard({
  summary,
  currency,
}: {
  summary: RemittanceSummary;
  currency: string;
}) {
  const { t } = useT();
  const optional: { key: keyof RemittanceSummary; label: string }[] = [
    { key: "expensesMinor", label: t("remittance.summary.expenses") },
    { key: "transferredOutMinor", label: t("remittance.summary.transferredOut") },
    { key: "debtClosedMinor", label: t("remittance.summary.debtClosed") },
    { key: "otherInMinor", label: t("remittance.summary.otherIn") },
    { key: "otherOutMinor", label: t("remittance.summary.otherOut") },
  ];
  return (
    <Card>
      <Stack gap="xs">
        <Line label={t("remittance.summary.opening")} amountMinor={summary.openingMinor} currency={currency} />
        <Line label={t("remittance.summary.collected")} amountMinor={summary.collectedMinor} currency={currency} />
        {optional
          .filter((o) => summary[o.key] > 0)
          .map((o) => (
            <Line key={o.key} label={o.label} amountMinor={summary[o.key]} currency={currency} />
          ))}
        <Line label={t("remittance.summary.expected")} amountMinor={summary.expectedMinor} currency={currency} strong />
      </Stack>
    </Card>
  );
}

/** Una rendición del historial: declarado, contado, faltante y si se rindió tarde. */
export function RemittanceHistoryItem({
  remittance,
  currency,
  title,
}: {
  remittance: RemittanceView;
  currency: string;
  /** Encabezado opcional (p. ej. el cobrador, en el historial del coordinador). */
  title?: string;
}) {
  const { t } = useT();
  const received = remittance.status === "RECEIVED";
  return (
    <Card>
      <Stack gap="xs">
        <Row className="items-center justify-between">
          <Text variant="label">{title ?? remittance.businessDate}</Text>
          <Badge
            label={t(`remittance.record.${remittance.status}`)}
            tone={received ? "success" : "warning"}
          />
        </Row>
        <Text variant="caption" tone="muted">
          {t("remittance.submittedAt")} {new Date(remittance.submittedAt).toLocaleString()}
          {remittance.lateMinutesAtSubmission > 0
            ? ` · ${t("remittance.lateBy")} ${formatLag(remittance.lateMinutesAtSubmission)}`
            : ""}
        </Text>
        <Line label={t("remittance.declared")} amountMinor={remittance.declaredMinor} currency={currency} />
        {received && remittance.countedMinor !== null ? (
          <Line label={t("remittance.counted")} amountMinor={remittance.countedMinor} currency={currency} />
        ) : null}
        {received && remittance.shortfallMinor ? (
          <Line label={t("remittance.shortfall")} amountMinor={remittance.shortfallMinor} currency={currency} strong />
        ) : null}
        {remittance.collectorNote ? (
          <Text variant="caption" tone="muted">
            {t("remittance.collectorNote")}: {remittance.collectorNote}
          </Text>
        ) : null}
        {remittance.receiverNote ? (
          <Text variant="caption" tone="muted">
            {t("remittance.receiverNote")}: {remittance.receiverNote}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}
