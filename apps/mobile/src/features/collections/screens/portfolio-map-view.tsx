import { useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import type { PortfolioMapClient } from "@preztiaos/contracts";
import {
  Badge,
  type BadgeTone,
  Card,
  ErrorState,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { usePortfolioMapClients } from "../api/map-queries";
import { CollectionMap } from "../components/collection-map";
import type { MapMarker, MapPoint } from "../components/collection-map.types";

// Centro por defecto si no hay clientes con ubicación (Bogotá), igual que la ruta crítica.
const DEFAULT_CENTER: MapPoint = { latitude: 4.711, longitude: -74.0721 };

// Severidad visual del cliente: pin del mapa, punto de la leyenda y badge del detalle.
const SEVERITY = {
  ok: { kind: "ok", dotClass: "bg-emerald-600", tone: "success", label: "Al día" },
  overdue: { kind: "overdue", dotClass: "bg-amber-500", tone: "warning", label: "En mora" },
  critical: { kind: "critical", dotClass: "bg-red-600", tone: "danger", label: "Mora crítica" },
} satisfies Record<string, { kind: MapMarker["kind"]; dotClass: string; tone: BadgeTone; label: string }>;

function severityOf(client: PortfolioMapClient) {
  if (client.critical) return SEVERITY.critical;
  return client.overdueCount > 0 ? SEVERITY.overdue : SEVERITY.ok;
}

/**
 * Pestaña "Todos los clientes" del mapa de cobro: pinta TODA la cartera activa con ubicación,
 * coloreada por severidad de mora; al tocar un marcador muestra la ficha completa del crédito
 * (saldo, cuotas, mora, próxima cuota y datos de contacto).
 */
export function PortfolioMapView() {
  const query = usePortfolioMapClients();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clients = query.data?.items ?? [];
  const selected = clients.find((c) => c.creditId === selectedId) ?? null;

  const markers = useMemo<MapMarker[]>(
    () =>
      clients.map((c) => ({
        id: c.creditId,
        latitude: c.latitude,
        longitude: c.longitude,
        label: c.borrowerName,
        kind: severityOf(c).kind,
      })),
    [clients],
  );

  if (query.isPending) return <Spinner label="Cargando cartera…" />;
  if (query.isError) {
    return (
      <ErrorState
        title="Mapa de clientes"
        description="No se pudo cargar la cartera activa."
        onRetry={() => query.refetch()}
      />
    );
  }

  if (clients.length === 0) {
    return (
      <Card>
        <Text tone="muted">No hay clientes con crédito activo y ubicación registrada.</Text>
      </Card>
    );
  }

  return (
    <Stack gap="lg">
      <Text variant="caption" tone="muted">
        Toda la cartera activa con ubicación registrada ({clients.length} en el mapa).
      </Text>

      <Row gap="lg" className="flex-wrap">
        {Object.values(SEVERITY).map((s) => (
          <Row key={s.label} gap="xs">
            <View className={`h-2.5 w-2.5 rounded-full ${s.dotClass}`} />
            <Text variant="caption" tone="muted">
              {s.label}
            </Text>
          </Row>
        ))}
      </Row>

      <CollectionMap
        center={clients[0] ?? DEFAULT_CENTER}
        markers={markers}
        route={[]}
        fitToMarkers
        onMarkerPress={setSelectedId}
      />

      {selected ? (
        <ClientDetailCard client={selected} />
      ) : (
        <Card>
          <Text variant="caption" tone="muted">
            Toca un marcador para ver el detalle del cliente y su crédito.
          </Text>
        </Card>
      )}
    </Stack>
  );
}

/** Ficha del cliente seleccionado: identificación, estado de mora y detalle del crédito. */
function ClientDetailCard({ client }: { client: PortfolioMapClient }) {
  const severity = severityOf(client);
  return (
    <Card>
      <Stack gap="sm">
        <Row className="justify-between">
          <Stack gap="none" className="flex-1">
            <Text variant="heading">{client.borrowerName}</Text>
            {client.business ? (
              <Text variant="caption" tone="muted">
                {client.business}
              </Text>
            ) : null}
          </Stack>
          <Badge tone={severity.tone} label={severity.label} />
        </Row>

        {client.zoneName ? <DetailRow label="Zona" value={client.zoneName} /> : null}
        {client.phone ? <DetailRow label="Teléfono" value={client.phone} /> : null}

        <DetailRow
          label="Prestado"
          value={<MoneyText variant="label" amountMinor={client.principalMinor} currency={client.currency} />}
        />
        <DetailRow
          label="Total a pagar"
          value={<MoneyText variant="label" amountMinor={client.totalDueMinor} currency={client.currency} />}
        />
        <DetailRow
          label="Pagado"
          value={<MoneyText variant="label" amountMinor={client.paidMinor} currency={client.currency} />}
        />
        <DetailRow
          label="Saldo pendiente"
          value={
            <MoneyText
              variant="label"
              tone={client.outstandingMinor > 0 ? "danger" : "success"}
              amountMinor={client.outstandingMinor}
              currency={client.currency}
            />
          }
        />
        <DetailRow
          label="Cuotas"
          value={`${client.installmentsPaid}/${client.installmentsCount} pagadas`}
        />
        {client.overdueCount > 0 ? (
          <DetailRow
            label="Vencidas"
            value={`${client.overdueCount} cuotas · ${client.daysOverdue} días`}
          />
        ) : null}
        {client.nextDueDate ? (
          <DetailRow label="Próxima cuota" value={formatBusinessDate(client.nextDueDate)} />
        ) : null}
        <DetailRow label="Inicio del crédito" value={formatBusinessDate(client.startDate)} />
      </Stack>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Row className="justify-between">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {typeof value === "string" ? <Text variant="label">{value}</Text> : value}
    </Row>
  );
}

// Fecha de negocio (yyyy-mm-dd) formateada en local; se ancla a medianoche LOCAL para que un
// huso negativo (Colombia/Brasil) no la corra al día anterior.
function formatBusinessDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString();
}
