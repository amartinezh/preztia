import { useState } from "react";
import { Linking } from "react-native";
import type { MyRouteStop } from "@preztiaos/contracts";
import { Badge, Button, Card, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useMarkRouteStopSeen, useMyRouteStops } from "../api/queries";
import { ResolveStopModal } from "./resolve-stop-modal";

const MS_PER_HOUR = 3_600_000;

/** Enlace de navegación al cliente: por coordenadas si las hay; si no, por dirección. */
function mapUrl(stop: MyRouteStop): string | null {
  if (stop.lat !== null && stop.lng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
  }
  return stop.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}` : null;
}

/**
 * "Mi ruta" del COBRADOR: las paradas que le despacharon, en orden de visita, con la VISTA MÍNIMA
 * del cliente (nombre, dirección, mapa, teléfono, monto a cobrar) y "solicitada el dd/mm hh:mm".
 * Al liquidar una parada deja de ver los datos del cliente; queda en su historial con el resultado.
 */
export function MyRouteSection() {
  const { t } = useT();
  const open = useMyRouteStops("open");
  const done = useMyRouteStops("done");
  const seen = useMarkRouteStopSeen();
  const [resolving, setResolving] = useState<MyRouteStop | null>(null);
  // Hora de referencia para la antigüedad de cada parada (fija por montaje: el render es puro).
  const [now] = useState(() => Date.now());
  const openItems = open.data?.pages.flatMap((p) => p.items) ?? [];
  const doneItems = done.data?.pages.flatMap((p) => p.items) ?? [];

  // Abrir la parada (mapa, llamada o liquidación) la marca vista la primera vez.
  const touch = (stop: MyRouteStop) => {
    if (stop.status === "ASSIGNED") seen.mutate(stop.id);
  };
  const openLink = (stop: MyRouteStop, url: string | null) => {
    touch(stop);
    if (url) void Linking.openURL(url);
  };

  return (
    <Stack gap="sm">
      <Text variant="heading">{t("route.mine.title")}</Text>
      {open.isPending ? <Spinner label={t("common.loading")} /> : null}
      {!open.isPending && openItems.length === 0 ? <Text tone="muted">{t("route.mine.empty")}</Text> : null}
      {openItems.map((stop) => {
        const ageHours = Math.floor((now - Date.parse(stop.dispatchedAt)) / MS_PER_HOUR);
        return (
          <Card key={stop.id}>
            <Stack gap="xs">
              <Row className="items-center justify-between">
                <Text variant="label" className="flex-1 pr-2">
                  {stop.sequence}. {stop.clientName}
                </Text>
                <MoneyText variant="label" amountMinor={stop.amountToCollectMinor} currency={stop.currency} />
              </Row>
              {stop.address ? <Text variant="caption">{stop.address}</Text> : null}
              <Text variant="caption" tone="muted">
                {t("route.mine.requestedAt")} {new Date(stop.dispatchedAt).toLocaleString()} · {ageHours} h
              </Text>
              <Row gap="sm" className="flex-wrap">
                {mapUrl(stop) ? (
                  <Button label={t("route.mine.map")} variant="ghost" size="sm" onPress={() => openLink(stop, mapUrl(stop))} />
                ) : null}
                {stop.phone ? (
                  <Button label={t("route.mine.call")} variant="ghost" size="sm" onPress={() => openLink(stop, `tel:${stop.phone}`)} />
                ) : null}
                <Button
                  label={t("route.mine.resolve")}
                  size="sm"
                  onPress={() => {
                    touch(stop);
                    setResolving(stop);
                  }}
                />
              </Row>
            </Stack>
          </Card>
        );
      })}

      {doneItems.length > 0 ? <Text variant="label">{t("route.mine.history")}</Text> : null}
      {doneItems.map((stop) => (
        <Row key={stop.id} className="items-center justify-between">
          <Stack gap="xs" className="flex-1 pr-2">
            <Text variant="caption">{stop.clientName}</Text>
            <Text variant="caption" tone="muted">
              {stop.resolvedAt ? new Date(stop.resolvedAt).toLocaleString() : stop.serviceDate}
            </Text>
          </Stack>
          <Badge
            label={stop.outcome ? t(`route.outcome.${stop.outcome}`) : t(`route.status.${stop.status}`)}
            tone={stop.outcome === "PAID" ? "success" : "neutral"}
          />
        </Row>
      ))}
      {done.hasNextPage ? (
        <Button label={t("common.loadMore")} variant="ghost" onPress={() => void done.fetchNextPage()} />
      ) : null}

      {resolving ? <ResolveStopModal stop={resolving} onClose={() => setResolving(null)} /> : null}
    </Stack>
  );
}
