import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { MAP_STYLE_URL, type CollectionMapProps } from "./collection-map.types";

const ORIGIN_COLOR = "#208AEF";
const CRITICAL_COLOR = "#e11d48";
const ROUTE_COLOR = "#208AEF";

/**
 * Mapa de cobro — implementación WEB con MapLibre GL JS (FOSS) + tiles OpenFreeMap (sin API key).
 * Pinta los marcadores de clientes críticos y el del cobrador, y dibuja la polilínea de la ruta
 * optimizada. Reactivo: re-pinta cuando cambian marcadores o ruta. (Expo web corre sobre el DOM,
 * por eso usa un contenedor `div` real.)
 */
export function CollectionMap({ center, markers, route }: CollectionMapProps) {
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

  // Marcadores.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerObjs.current.forEach((m) => m.remove());
    markerObjs.current = markers.map((mk) => {
      const color = mk.kind === "origin" ? ORIGIN_COLOR : CRITICAL_COLOR;
      const label = mk.order ? `${mk.order}. ${mk.label}` : mk.label;
      return new maplibregl.Marker({ color })
        .setLngLat([mk.longitude, mk.latitude])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(label))
        .addTo(map);
    });
  }, [markers]);

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
