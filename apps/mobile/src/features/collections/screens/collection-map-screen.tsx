import { useMemo, useState } from "react";
import { Alert, Pressable } from "react-native";
import * as Location from "expo-location";
import type { CriticalRouteOutput } from "@preztiaos/contracts";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useCriticalClients, useCriticalRoute } from "../api/map-queries";
import { CollectionMap } from "../components/collection-map";
import type { MapMarker, MapPoint } from "../components/collection-map.types";
import { PortfolioMapView } from "./portfolio-map-view";

// Centro por defecto si aún no hay ubicación del cobrador ni clientes (Bogotá).
const DEFAULT_CENTER: MapPoint = { latitude: 4.711, longitude: -74.0721 };

type TabKey = "route" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "route", label: "Ruta de cobro" },
  { key: "all", label: "Todos los clientes" },
];

/**
 * Mapa de cobro con dos pestañas: "Ruta de cobro" ubica a los clientes en mora CRÍTICA y genera
 * la ruta óptima (OSRM, en backend) desde la posición del cobrador; "Todos los clientes" pinta
 * toda la cartera activa y muestra la ficha del crédito al tocar un marcador. Web y nativo
 * comparten esta pantalla; el mapa se resuelve por plataforma.
 */
export function CollectionMapScreen() {
  const [tab, setTab] = useState<TabKey>("route");

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">Mapa de cobro</Text>

        <Row gap="sm">
          {TABS.map((t) => {
            const isActive = t.key === tab;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => setTab(t.key)}
                className={`min-h-[40px] justify-center rounded-full border px-4 ${
                  isActive
                    ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <Text variant="label" tone={isActive ? "primary" : "muted"}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        {tab === "route" ? <CriticalRouteView /> : <PortfolioMapView />}
      </Stack>
    </Screen>
  );
}

/**
 * Pestaña "Ruta de cobro": clientes en mora crítica y, con un botón, la ruta óptima para
 * visitarlos de la forma más eficiente desde la posición actual del cobrador.
 */
function CriticalRouteView() {
  const clientsQuery = useCriticalClients();
  const route = useCriticalRoute();
  const [origin, setOrigin] = useState<MapPoint | null>(null);
  const [result, setResult] = useState<CriticalRouteOutput | null>(null);

  const clients = clientsQuery.data?.items ?? [];

  // Orden de visita por crédito (cuando ya hay ruta), para numerar los marcadores.
  const orderByCredit = useMemo(() => {
    const map = new Map<string, number>();
    result?.stops.forEach((s) => map.set(s.creditId, s.order));
    return map;
  }, [result]);

  const markers = useMemo<MapMarker[]>(() => {
    const pins: MapMarker[] = clients.map((c) => ({
      id: c.creditId,
      latitude: c.latitude,
      longitude: c.longitude,
      label: c.borrowerName,
      kind: "critical",
      ...(orderByCredit.has(c.creditId) ? { order: orderByCredit.get(c.creditId) } : {}),
    }));
    if (origin) {
      pins.push({ id: "origin", ...origin, label: "Tu ubicación", kind: "origin" });
    }
    return pins;
  }, [clients, origin, orderByCredit]);

  const center = origin ?? clients[0] ?? DEFAULT_CENTER;
  const routeGeometry = result?.geometry ?? [];

  const generateRoute = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Ubicación requerida", "Activa el permiso de ubicación para trazar la ruta de cobro.");
      return;
    }
    const pos = await Location.getCurrentPositionAsync({});
    const start: MapPoint = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    setOrigin(start);
    route.mutate(start, {
      onSuccess: (data) => {
        setResult(data);
        if (data.degraded) {
          Alert.alert(
            "Ruta sin optimizar",
            "El motor de rutas no estuvo disponible; se muestran los clientes sin orden óptimo.",
          );
        }
      },
      onError: () => Alert.alert("Error", "No se pudo generar la ruta de cobro."),
    });
  };

  if (clientsQuery.isPending) return <Spinner label="Cargando clientes críticos…" />;
  if (clientsQuery.isError) {
    return (
      <ErrorState
        title="Mapa de cobro"
        description="No se pudieron cargar los clientes críticos."
        onRetry={() => clientsQuery.refetch()}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Text variant="caption" tone="muted">
        Clientes con ≥ {clientsQuery.data?.threshold} cuotas vencidas ({clients.length} en riesgo).
      </Text>

      {clients.length === 0 ? (
        <Card>
          <Text tone="muted">No hay clientes en mora crítica con ubicación registrada.</Text>
        </Card>
      ) : (
        <>
          <CollectionMap center={center} markers={markers} route={routeGeometry} />

          <Button
            label="Generar ruta crítica"
            block
            loading={route.isPending}
            onPress={generateRoute}
          />

          {result ? (
            <Card>
              <Stack gap="sm">
                <Row className="justify-between">
                  <Text variant="heading">Ruta de cobro</Text>
                  {result.degraded ? <Badge tone="warning" label="Sin optimizar" /> : null}
                </Row>
                {!result.degraded ? (
                  <Text variant="caption" tone="muted">
                    {(result.distanceMeters / 1000).toFixed(1)} km ·{" "}
                    {Math.round(result.durationSeconds / 60)} min en total
                  </Text>
                ) : null}
                {result.stops.map((s) => (
                  <Row key={s.creditId} className="items-center justify-between">
                    <Row className="items-center gap-2">
                      <Badge tone="info" label={String(s.order)} />
                      <Stack gap="none">
                        <Text variant="label">{s.borrowerName}</Text>
                        <Text variant="caption" tone="muted">
                          {s.overdueCount} cuotas vencidas · {s.daysOverdue}d
                        </Text>
                      </Stack>
                    </Row>
                    <MoneyText
                      variant="caption"
                      amountMinor={s.outstandingMinor}
                      currency={s.currency}
                    />
                  </Row>
                ))}
              </Stack>
            </Card>
          ) : null}
        </>
      )}
    </Stack>
  );
}
