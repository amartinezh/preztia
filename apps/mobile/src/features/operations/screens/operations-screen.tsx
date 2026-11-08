import type { ChangeRequest } from "@preztiaos/contracts";
import {
  Badge,
  Button,
  Card,
  ListItem,
  Row,
  Spinner,
  Stack,
  Text,
  type BadgeTone,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { useClientPositions } from "@/features/tracking/api/queries";
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

function summarizeChanges(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .map(([k, v]) => `${k}: ${v ?? "—"}`)
    .join(" · ");
}
