import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface OptimizedRoute {
  /** Índices de las paradas de entrada en el ORDEN óptimo de visita. */
  readonly order: number[];
  /** Geometría de la ruta (puntos para la polilínea). Vacía si el motor no estuvo disponible. */
  readonly geometry: GeoPoint[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /** true si OSRM no respondió y se devolvió un orden de respaldo sin geometría. */
  readonly degraded: boolean;
}

interface OsrmTripResponse {
  code: string;
  trips?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }[];
  waypoints?: { waypoint_index: number }[];
}

/**
 * Optimizador de rutas con OSRM (Open Source Routing Machine, FOSS). Usa el servicio `/trip`
 * (optimización tipo TSP) con el origen FIJO (la posición del cobrador) y ruta ABIERTA (no vuelve
 * al inicio): devuelve el ORDEN de visita más eficiente + la geometría para dibujar. El host es
 * configurable (`OSRM_BASE_URL`). Degradación elegante: si OSRM falla o no está configurado,
 * devuelve las paradas en su orden original sin geometría (`degraded=true`), sin romper la pantalla.
 */
@Injectable()
export class OsrmRouteOptimizer {
  private readonly logger = new Logger('Collections:Routing');

  async optimize(input: {
    start: GeoPoint;
    stops: readonly GeoPoint[];
  }): Promise<OptimizedRoute> {
    const fallback: OptimizedRoute = {
      order: input.stops.map((_, i) => i),
      geometry: [],
      distanceMeters: 0,
      durationSeconds: 0,
      degraded: true,
    };
    if (input.stops.length === 0) return { ...fallback, degraded: false };

    try {
      const base = process.env.OSRM_BASE_URL ?? DEFAULT_OSRM_BASE_URL;
      // OSRM espera lon,lat separados por ';'. El origen va primero (source=first).
      const coords = [input.start, ...input.stops]
        .map((p) => `${p.longitude},${p.latitude}`)
        .join(';');
      const url =
        `${base}/trip/v1/driving/${coords}` +
        `?source=first&roundtrip=false&geometries=geojson&overview=full`;

      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`OSRM respondió ${res.status}`);
      const data = (await res.json()) as OsrmTripResponse;
      const trip = data.trips?.[0];
      if (data.code !== 'Ok' || !trip || !data.waypoints) {
        throw new Error(`OSRM código ${data.code}`);
      }

      // waypoints[0] es el origen; las paradas son waypoints[1..]. `waypoint_index` da su posición
      // en el viaje óptimo; reordenamos las paradas de entrada por ese índice.
      const stopWaypoints = data.waypoints
        .slice(1)
        .map((w, inputIndex) => ({ inputIndex, tripIndex: w.waypoint_index }))
        .sort((a, b) => a.tripIndex - b.tripIndex);

      return {
        order: stopWaypoints.map((w) => w.inputIndex),
        geometry: trip.geometry.coordinates.map(([lon, lat]) => ({
          latitude: lat,
          longitude: lon,
        })),
        distanceMeters: trip.distance,
        durationSeconds: trip.duration,
        degraded: false,
      };
    } catch (err) {
      this.logger.warn(
        `OSRM no disponible; ruta de respaldo sin optimizar: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }
}
