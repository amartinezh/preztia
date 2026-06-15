import type { ChangeRequest } from "@preztiaos/contracts";
import {
  Badge,
  Button,
  Card,
  ListItem,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  type BadgeTone,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { useClientPositions } from "@/features/tracking/api/queries";
import { useDashboard } from "@/features/reporting/api/queries";
import { useChangeRequests, useReviewChangeRequest, useRoutes } from "../api/queries";

const STATUS_TONE: Record<ChangeRequest["status"], BadgeTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const POSITION_TONE: Record<"NO_CREDIT" | "CURRENT" | "OVERDUE", BadgeTone> = {
  NO_CREDIT: "neutral",
  CURRENT: "info",
  OVERDUE: "danger",
};

/** Operación (socio): lista de cobros (rutas) + bandeja de solicitudes de modificación. */
export function OperationsScreen() {
  const { t } = useT();
  const routes = useRoutes();
  const requests = useChangeRequests();
  const review = useReviewChangeRequest();
  const positions = useClientPositions();

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("operations.title")}</Text>

        <DashboardCard />

        <Stack gap="sm">
          <Text variant="heading">{t("tracking.positions.title")}</Text>
          {positions.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : positions.data?.items.length ? (
            positions.data.items.map((p) => (
              <ListItem
                key={p.borrowerId}
                title={p.name ?? p.borrowerId.slice(0, 8)}
                subtitle={`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
                trailing={
                  <Badge
                    label={t(`tracking.status.${p.status}` as Parameters<typeof t>[0])}
                    tone={POSITION_TONE[p.status]}
                  />
                }
              />
            ))
          ) : (
            <Text tone="muted">{t("tracking.positions.empty")}</Text>
          )}
        </Stack>

        <Stack gap="sm">
          <Text variant="heading">{t("operations.routes.title")}</Text>
          {routes.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : routes.data?.items.length ? (
            routes.data.items.map((r) => (
              <ListItem
                key={r.collectorId}
                title={r.name}
                subtitle={`${t("operations.routes.clients")}: ${r.clientsCount} · ${r.zonePaths.join(", ") || "—"}`}
                trailing={<Badge label={r.code} tone="neutral" />}
              />
            ))
          ) : (
            <Text tone="muted">{t("operations.routes.empty")}</Text>
          )}
        </Stack>

        <Stack gap="sm">
          <Text variant="heading">{t("operations.requests.title")}</Text>
          {requests.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : requests.data?.items.length ? (
            requests.data.items.map((cr) => (
              <Card key={cr.id}>
                <Stack gap="xs">
                  <Row className="justify-between">
                    <Text variant="label">{t("operations.requests.client")}: {cr.borrowerId.slice(0, 8)}</Text>
                    <Badge label={t(`operations.status.${cr.status}` as Parameters<typeof t>[0])} tone={STATUS_TONE[cr.status]} />
                  </Row>
                  <Text variant="caption" tone="muted">{summarizeChanges(cr.changes)}</Text>
                  {cr.status === "PENDING" ? (
                    <Row className="gap-2">
                      <Button label={t("operations.requests.approve")} size="sm" onPress={() => review.mutate({ id: cr.id, approve: true })} />
                      <Button label={t("operations.requests.reject")} variant="ghost" size="sm" onPress={() => review.mutate({ id: cr.id, approve: false })} />
                    </Row>
                  ) : null}
                </Stack>
              </Card>
            ))
          ) : (
            <Text tone="muted">{t("operations.requests.empty")}</Text>
          )}
        </Stack>
      </Stack>
    </Screen>
  );
}

/** Panel del tenant: KPIs de cartera, cobro del día, caja y pendientes. */
function DashboardCard() {
  const { t } = useT();
  const query = useDashboard();
  if (query.isPending || !query.data) return <Spinner label={t("common.loading")} />;
  const d = query.data;
  return (
    <Card>
      <Stack gap="xs">
        <Text variant="heading">{t("dashboard.title")}</Text>
        <KpiRow label={t("dashboard.borrowers")} value={String(d.totalBorrowers)} />
        <KpiRow label={t("dashboard.activeCredits")} value={String(d.activeCredits)} />
        <KpiRow label={t("dashboard.overdue")} value={String(d.overdueAccounts)} />
        <Row className="justify-between">
          <Text tone="muted">{t("dashboard.portfolio")}</Text>
          <MoneyText variant="label" amountMinor={d.portfolioOutstandingMinor} currency={d.currency} />
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("dashboard.collectedToday")}</Text>
          <MoneyText variant="label" amountMinor={d.collectedTodayMinor} currency={d.currency} />
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("dashboard.cash")}</Text>
          <MoneyText variant="label" amountMinor={d.cashCurrentMinor} currency={d.currency} />
        </Row>
        <KpiRow label={t("dashboard.pending")} value={`${d.pendingExpenses + d.pendingChangeRequests}`} />
      </Stack>
    </Card>
  );
}

function KpiRow({ label, value }: { label: string; value: string }) {
  return (
    <Row className="justify-between">
      <Text tone="muted">{label}</Text>
      <Text variant="label">{value}</Text>
    </Row>
  );
}

function summarizeChanges(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .map(([k, v]) => `${k}: ${v ?? "—"}`)
    .join(" · ");
}
