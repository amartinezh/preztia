import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { MAP_STYLE_URL, type CollectionMapProps, type MapMarker } from "./collection-map.types";

// Color del pin según el estado del cliente (misma paleta que la versión nativa).
const MARKER_COLORS: Record<MapMarker["kind"], string> = {
  origin: "#208AEF",
  ok: "#059669",
  overdue: "#d97706",
  critical: "#e11d48",
};
const ROUTE_COLOR = "#208AEF";
const FIT_PADDING_PX = 48;
const FIT_MAX_ZOOM = 15;

/**
 * Mapa de cobro — implementación WEB con MapLibre GL JS (FOSS) + tiles OpenFreeMap (sin API key).
 * Pinta los marcadores (color según severidad) y la polilínea de la ruta optimizada. Con
 * `onMarkerPress` el clic sobre un pin selecciona al cliente (el detalle lo pinta la pantalla);
 * sin él, el pin abre un popup con su rótulo. `fitToMarkers` encuadra todos los pines. Reactivo:
 * re-pinta cuando cambian marcadores o ruta. (Expo web corre sobre el DOM, por eso usa un `div`.)
 */
export function CollectionMap({
  center,
  markers,
  route,
  fitToMarkers,
  onMarkerPress,
}: CollectionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjs = useRef<maplibregl.Marker[]>([]);

  // Inicializa el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [center.longitude, center.latitude],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marcadores (y encuadre a todos ellos si se pidió).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerObjs.current.forEach((m) => m.remove());
    markerObjs.current = markers.map((mk) => {
      const marker = new maplibregl.Marker({ color: MARKER_COLORS[mk.kind] }).setLngLat([
        mk.longitude,
        mk.latitude,
      ]);
      if (onMarkerPress) {
        const el = marker.getElement();
        el.style.cursor = "pointer";
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          onMarkerPress(mk.id);
        });
      } else {
        const label = mk.order ? `${mk.order}. ${mk.label}` : mk.label;
        marker.setPopup(new maplibregl.Popup({ offset: 24 }).setText(label));
      }
      return marker.addTo(map);
    });

    if (fitToMarkers && markers.length > 0) {
      const first: [number, number] = [markers[0].longitude, markers[0].latitude];
      const bounds = markers.reduce(
        (b, mk) => b.extend([mk.longitude, mk.latitude]),
        new maplibregl.LngLatBounds(first, first),
      );
      map.fitBounds(bounds, { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, duration: 0 });
    }
  }, [markers, fitToMarkers, onMarkerPress]);

  // Polilínea de la ruta.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: route.map((p) => [p.longitude, p.latitude]),
      },
    } as GeoJSON.Feature;
    const draw = () => {
      const existing = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }
      map.addSource("route", { type: "geojson", data });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: { "line-color": ROUTE_COLOR, "line-width": 4 },
      });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [route]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: 420, borderRadius: 12, overflow: "hidden" }}
    />
  );
}
