// Dominio puro de GEOLOCALIZACIÓN: validación de coordenadas (lat/lng) para el seguimiento del
// cobrador (recorrido / último registro) y la ubicación del cliente. Sin I/O ni framework.

import { DomainError } from "../shared/money";

const LAT_MAX = 90;
const LNG_MAX = 180;

/** Valida que (lat, lng) sean coordenadas geográficas válidas; falla rápido si no. */
export function assertCoordinate(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || lat < -LAT_MAX || lat > LAT_MAX) {
    throw new DomainError("Latitud fuera de rango [-90, 90]");
  }
  if (!Number.isFinite(lng) || lng < -LNG_MAX || lng > LNG_MAX) {
    throw new DomainError("Longitud fuera de rango [-180, 180]");
  }
}
