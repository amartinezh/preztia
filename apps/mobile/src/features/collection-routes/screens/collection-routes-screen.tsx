import { useState } from "react";
import type { ProposedStop } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  MoneyText,
  Row,
  Select,
  Spinner,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useUsersList } from "@/features/users/api/queries";
import { useZonesList } from "@/features/zones/api/queries";
import { useDispatchRoute, useRouteProposal, useRoutes } from "../api/queries";
import { RouteDetailModal } from "../components/route-detail-modal";

// Centinela del selector: la parada queda fuera del despacho.
const SKIP = "";

/**
 * RUTAS DE COBRO del coordinador: pide la propuesta de una zona (clientes que necesitan visita, en
 * orden de recorrido, con el monto vencido), reparte cada parada a un cobrador y despacha. Abajo,
 * las rutas despachadas con su avance; cada una abre el detalle por parada.
 */
export function CollectionRoutesScreen() {
  const { t } = useT();
  const zones = useZonesList();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const zoneOptions: SelectOption<string>[] = (zones.data?.items ?? []).map((z) => ({
    value: z.id,
    label: z.name,
    hint: z.path,
  }));

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("route.title")}</Text>
        <Field label={t("credit.new.zone")}>
          <Select value={zoneId} options={zoneOptions} onChange={setZoneId} placeholder={t("credit.new.zone.placeholder")} />
        </Field>
        {zoneId ? <ProposalBuilder key={zoneId} zoneId={zoneId} /> : null}

        <Text variant="heading">{t("route.dispatched")}</Text>
        <DispatchedRoutes onOpen={setOpenRoute} />
      </Stack>
      <RouteDetailModal routeId={openRoute} onClose={() => setOpenRoute(null)} />
    </Screen>
  );
}

function ProposalBuilder({ zoneId }: { zoneId: string }) {
  const { t } = useT();
  const proposal = useRouteProposal(zoneId);
  const collectors = useUsersList("COLLECTOR");
  const dispatch = useDispatchRoute();
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const collectorOptions: SelectOption<string>[] = [
    { value: SKIP, label: t("route.skip") },
    ...(collectors.data?.pages.flatMap((p) => p.items) ?? [])
      .filter((u) => u.active)
      .map((u) => ({ value: u.id, label: u.email })),
  ];
  const stops = (proposal.data?.items ?? []).filter((s) => !s.alreadyDispatched);
  const chosen = stops.filter((s) => assigned[s.creditId]);

  const assignAll = (collectorId: string) =>
    setAssigned(Object.fromEntries(stops.map((s) => [s.creditId, collectorId])));

  const submit = () => {
    setError(null);
    setSent(false);
    dispatch.mutate(
      { zoneId, stops: chosen.map((s) => ({ creditId: s.creditId, collectorId: assigned[s.creditId]! })) },
      {
        onSuccess: () => {
          setAssigned({});
          setSent(true);
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  if (proposal.isPending) return <Spinner label={t("common.loading")} />;
  return (
    <Stack gap="sm">
      {error ? <Banner tone="danger" title={error} /> : null}
      {sent ? <Banner tone="success" title={t("route.sent")} /> : null}
      {proposal.data?.degraded ? <Banner tone="warning" title={t("route.degraded")} /> : null}
      {stops.length === 0 ? (
        <Text tone="muted">{t("route.proposal.empty")}</Text>
      ) : (
        <Field label={t("route.assignAll")}>
          <Select value={null} options={collectorOptions.slice(1)} onChange={assignAll} placeholder={t("route.assignAllPlaceholder")} />
        </Field>
      )}
      {stops.map((s: ProposedStop, index) => (
        <Card key={s.creditId}>
          <Stack gap="xs">
            <Row className="items-center justify-between">
              <Text variant="label" className="flex-1 pr-2">
                {index + 1}. {s.clientName}
              </Text>
              <MoneyText variant="label" amountMinor={s.amountToCollectMinor} currency={s.currency} />
            </Row>
            <Row className="items-center justify-between">
              <Text variant="caption" tone="muted">
                {s.address ?? t("route.noAddress")}
              </Text>
              <Badge label={`${s.overdueCount} ${t("route.overdue")}`} tone="danger" />
            </Row>
            <Select
              value={assigned[s.creditId] ?? SKIP}
              options={collectorOptions}
              onChange={(v) => setAssigned((a) => ({ ...a, [s.creditId]: v }))}
            />
          </Stack>
        </Card>
      ))}
      {stops.length > 0 ? (
        <Button
          label={`${t("route.dispatch")} (${chosen.length})`}
          loading={dispatch.isPending}
          disabled={chosen.length === 0}
          block
          onPress={submit}
        />
      ) : null}
    </Stack>
  );
}

function DispatchedRoutes({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useT();
  const routes = useRoutes();
  const items = routes.data?.pages.flatMap((p) => p.items) ?? [];
  if (routes.isPending) return <Spinner label={t("common.loading")} />;
  if (items.length === 0) return <Text tone="muted">{t("route.none")}</Text>;
  return (
    <Stack gap="sm">
      {items.map((r) => (
        <Card key={r.id}>
          <Stack gap="xs">
            <Row className="items-center justify-between">
              <Text variant="label">
                {r.zoneName ?? r.zoneId} · {r.serviceDate}
              </Text>
              <MoneyText variant="label" amountMinor={r.collectedMinor} currency={r.currency} />
            </Row>
            <Text variant="caption" tone="muted">
              {t("route.progress")
                .replace("{resolved}", String(r.resolvedStops))
                .replace("{total}", String(r.totalStops))}{" "}
              · {new Date(r.dispatchedAt).toLocaleString()}
            </Text>
            <Button label={t("route.detail.open")} variant="ghost" size="sm" onPress={() => onOpen(r.id)} />
          </Stack>
        </Card>
      ))}
      {routes.hasNextPage ? (
        <Button label={t("common.loadMore")} variant="ghost" onPress={() => void routes.fetchNextPage()} />
      ) : null}
    </Stack>
  );
}
