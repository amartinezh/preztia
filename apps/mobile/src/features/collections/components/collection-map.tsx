import { View } from "react-native";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
} from "@maplibre/maplibre-react-native";
import { Text } from "@preztiaos/ui";

import { MAP_STYLE_URL, type CollectionMapProps, type MapMarker } from "./collection-map.types";

// Color del pin según el estado del cliente (misma paleta que la versión web).
const MARKER_CLASSES: Record<MapMarker["kind"], string> = {
  origin: "bg-brand-600",
  ok: "bg-emerald-600",
  overdue: "bg-amber-500",
  critical: "bg-red-600",
};
const ROUTE_COLOR = "#208AEF";
const FIT_PADDING_PX = 48;

/**
 * Mapa de cobro — implementación NATIVA con MapLibre RN (FOSS) + tiles OpenFreeMap (sin API key).
 * Requiere un dev build (módulo nativo; no corre en Expo Go). Pinta los marcadores (color según
 * severidad) y la polilínea de la ruta optimizada; con `onMarkerPress` el toque sobre un pin
 * selecciona al cliente y `fitToMarkers` encuadra todos los pines. La forma de las props es
 * idéntica a la versión web (split por plataforma).
 */
export function CollectionMap({
  center,
  markers,
  route,
  fitToMarkers,
  onMarkerPress,
}: CollectionMapProps) {
  const routeFeature = {
    type: "FeatureCollection",
    features: route.length
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: route.map((p) => [p.longitude, p.latitude]),
            },
          },
        ]
      : [],
  } as GeoJSON.FeatureCollection;

  // Caja [oeste, sur, este, norte] que contiene todos los marcadores; con 0/1 pines no aplica
  // (con uno solo el encuadre degenera en zoom máximo, mejor centrar con zoom fijo).
  const bounds =
    fitToMarkers && markers.length > 1
      ? ([
          Math.min(...markers.map((m) => m.longitude)),
          Math.min(...markers.map((m) => m.latitude)),
          Math.max(...markers.map((m) => m.longitude)),
          Math.max(...markers.map((m) => m.latitude)),
        ] as [number, number, number, number])
      : null;

  return (
    <View style={{ height: 420, borderRadius: 12, overflow: "hidden" }}>
      <Map mapStyle={MAP_STYLE_URL} style={{ flex: 1 }}>
        {bounds ? (
          <Camera
            bounds={bounds}
            padding={{
              top: FIT_PADDING_PX,
              right: FIT_PADDING_PX,
              bottom: FIT_PADDING_PX,
              left: FIT_PADDING_PX,
            }}
          />
        ) : (
          <Camera center={[center.longitude, center.latitude]} zoom={12} />
        )}

        {route.length ? (
          <GeoJSONSource id="route" data={routeFeature}>
            <Layer
              id="route-line"
              type="line"
              style={{ lineColor: ROUTE_COLOR, lineWidth: 4 }}
            />
          </GeoJSONSource>
        ) : null}

        {markers.map((mk) => (
          <Marker
            key={mk.id}
            id={mk.id}
            lngLat={[mk.longitude, mk.latitude]}
            onPress={onMarkerPress ? () => onMarkerPress(mk.id) : undefined}
          >
            <View
              className={`h-7 w-7 items-center justify-center rounded-full border-2 border-white ${MARKER_CLASSES[mk.kind]}`}
            >
              <Text variant="caption" tone="inverse">
                {mk.order ?? "•"}
              </Text>
            </View>
          </Marker>
        ))}
      </Map>
    </View>
  );
}
