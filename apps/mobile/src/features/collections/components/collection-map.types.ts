/** Punto geográfico (cliente, origen o vértice de la ruta). */
export interface MapPoint {
  latitude: number;
  longitude: number;
}

/** Marcador a pintar en el mapa. */
export interface MapMarker extends MapPoint {
  id: string;
  label: string;
  /** origin = punto de partida del cobrador; critical = cliente en mora. */
  kind: "origin" | "critical";
  /** Orden de visita (1..N) cuando ya hay ruta optimizada; undefined si aún no. */
  order?: number;
}

/** Props del mapa de cobro (misma forma en web y nativo; la implementación se resuelve por plataforma). */
export interface CollectionMapProps {
  center: MapPoint;
  markers: MapMarker[];
  /** Vértices de la polilínea de la ruta; vacío = sin ruta dibujada. */
  route: MapPoint[];
}

/** Estilo de tiles por defecto: OpenFreeMap (FOSS, sin API key). Configurable por env. */
export const MAP_STYLE_URL =
  process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";
