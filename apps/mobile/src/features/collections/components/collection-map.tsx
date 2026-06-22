import { View } from "react-native";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
} from "@maplibre/maplibre-react-native";
import { Text } from "@preztiaos/ui";

import { MAP_STYLE_URL, type CollectionMapProps } from "./collection-map.types";

const ROUTE_COLOR = "#208AEF";

/**
 * Mapa de cobro — implementación NATIVA con MapLibre RN (FOSS) + tiles OpenFreeMap (sin API key).
 * Requiere un dev build (módulo nativo; no corre en Expo Go). Pinta los marcadores y la polilínea
 * de la ruta optimizada. La forma de las props es idéntica a la versión web (split por plataforma).
 */
export function CollectionMap({ center, markers, route }: CollectionMapProps) {
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

  return (
    <View style={{ height: 420, borderRadius: 12, overflow: "hidden" }}>
      <Map mapStyle={MAP_STYLE_URL} style={{ flex: 1 }}>
        <Camera center={[center.longitude, center.latitude]} zoom={12} />

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
          <Marker key={mk.id} id={mk.id} lngLat={[mk.longitude, mk.latitude]}>
            <View
              className={`h-7 w-7 items-center justify-center rounded-full border-2 border-white ${
                mk.kind === "origin" ? "bg-brand-600" : "bg-red-600"
              }`}
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
