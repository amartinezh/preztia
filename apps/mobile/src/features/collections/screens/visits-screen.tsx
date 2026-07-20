import { useMemo, useState } from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { VisitStatus, VisitTarget } from "@preztiaos/contracts";
import {
  Badge,
  Card,
  ErrorState,
  ListItem,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { useCollectionVisits } from "../api/visits-queries";
import { CollectionMap } from "../components/collection-map";
import type { MapMarker, MapPoint } from "../components/collection-map.types";

// Centro por defecto si aún no hay clientes con coordenadas (Bogotá).
const DEFAULT_CENTER: MapPoint = { latitude: 4.711, longitude: -74.0721 };

const TABS: { key: VisitStatus; labelKey: "visits.pending" | "visits.visited" }[] = [
  { key: "pending", labelKey: "visits.pending" },
  { key: "visited", labelKey: "visits.visited" },
];

/**
 * Pantalla de VISITAS DE COBRO del cobrador: dos pestañas — "Por visitar" (clientes con la mora
 * suficiente, ayudados por el mapa) y "Visitados" (ya atendidos en el ciclo vigente). Cada cliente
 * abre el detalle del cobro, donde deja observaciones y marca la visita.
 */
export function VisitsScreen() {
  const { t } = useT();
  const [tab, setTab] = useState<VisitStatus>("pending");

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("visits.title")}</Text>

        <Row gap="sm">
          {TABS.map((item) => {
            const isActive = item.key === tab;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => setTab(item.key)}
                className={`min-h-[40px] justify-center rounded-full border px-4 ${
                  isActive
                    ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <Text variant="label" tone={isActive ? "primary" : "muted"}>
                  {t(item.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        <VisitList status={tab} />
      </Stack>
    </Screen>
  );
}

function VisitList({ status }: { status: VisitStatus }) {
  const { t } = useT();
  const router = useRouter();
  const query = useCollectionVisits(status);

  const items = useMemo<VisitTarget[]>(() => query.data?.items ?? [], [query.data]);
  const threshold = query.data?.threshold ?? 0;

  const withCoords = useMemo(
    () => items.filter((c) => c.latitude != null && c.longitude != null),
    [items],
  );
  const markers = useMemo<MapMarker[]>(
    () =>
      withCoords.map((c) => ({
        id: c.creditId,
        latitude: c.latitude as number,
        longitude: c.longitude as number,
        label: c.borrowerName,
        kind: "overdue",
      })),
    [withCoords],
  );

  const openDetail = (item: VisitTarget) => {
    // Se pasan los datos ya conocidos como query para pintar el encabezado sin otra consulta.
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

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return (
      <ErrorState
        title={t("visits.title")}
        description={t("errors.unknown")}
        onRetry={() => query.refetch()}
      />
    );
  }

  return (
    <Stack gap="md">
      <Text variant="caption" tone="muted">
        {t("visits.threshold").replace("{n}", String(threshold))}
      </Text>

      {status === "pending" && markers.length > 0 ? (
        <CollectionMap
          center={markers[0] ?? DEFAULT_CENTER}
          markers={markers}
          route={[]}
          fitToMarkers
          onMarkerPress={(id) => {
            const found = items.find((c) => c.creditId === id);
            if (found) openDetail(found);
          }}
        />
      ) : null}

      {items.length === 0 ? (
        <Card>
          <Text tone="muted">
            {status === "pending" ? t("visits.empty.pending") : t("visits.empty.visited")}
          </Text>
        </Card>
      ) : (
        items.map((item) => (
          <ListItem
            key={item.creditId}
            onPress={() => openDetail(item)}
            title={item.borrowerName || item.creditId.slice(0, 8)}
            subtitle={t("visits.overdue")
              .replace("{n}", String(item.overdueCount))
              .replace("{d}", String(item.daysOverdue))}
            trailing={
              <Row className="items-center gap-2">
                <MoneyText
                  variant="caption"
                  amountMinor={item.outstandingMinor}
                  currency={item.currency}
                />
                {status === "visited" ? <Badge tone="success" label="✓" /> : null}
              </Row>
            }
          />
        ))
      )}
    </Stack>
  );
}
