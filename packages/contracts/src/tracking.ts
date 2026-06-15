import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de GEO / TRACKING: el cobrador registra su posición; el socio ve el recorrido y el
// "Lugar último registro", y la "Posición de Clientes" (mapa de deudores por estado).

export const coordinate = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

export const recordLocationInput = coordinate;
export type RecordLocationInput = z.infer<typeof recordLocationInput>;

export const locationPoint = z.object({
  lat: z.number(),
  lng: z.number(),
  recordedAt: z.string(),
});
export type LocationPoint = z.infer<typeof locationPoint>;

export const trackOutput = z.object({ items: z.array(locationPoint) });
export const lastLocationOutput = z.object({ point: locationPoint.nullable() });

// Estado del cliente en el mapa (espejo del dominio): sin créditos / al día / con atrasos.
export const borrowerPositionStatus = z.enum(["NO_CREDIT", "CURRENT", "OVERDUE"]);
export type BorrowerPositionStatus = z.infer<typeof borrowerPositionStatus>;

export const clientPosition = z.object({
  borrowerId: z.string().uuid(),
  name: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  status: borrowerPositionStatus,
});
export type ClientPosition = z.infer<typeof clientPosition>;

export const clientPositionsOutput = z.object({ items: z.array(clientPosition) });

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const collectorIdParam = z.object({ id: z.string().uuid() });
// Día del recorrido (YYYY-MM-DD); por defecto hoy en el servidor.
const trackQuery = z.object({ date: z.string().date().optional() });

export const trackingContract = c.router({
  recordLocation: {
    method: "POST",
    path: "/me/locations",
    headers: tenantHeaders,
    body: recordLocationInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Registra la posición actual del cobrador autenticado",
  },
  getCollectorTrack: {
    method: "GET",
    path: "/collectors/:id/track",
    pathParams: collectorIdParam,
    headers: tenantHeaders,
    query: trackQuery,
    responses: { 200: trackOutput },
    summary: "Recorrido (puntos GPS) de un cobrador en un día",
  },
  getCollectorLastLocation: {
    method: "GET",
    path: "/collectors/:id/last-location",
    pathParams: collectorIdParam,
    headers: tenantHeaders,
    responses: { 200: lastLocationOutput },
    summary: "Lugar del último registro de un cobrador",
  },
  getClientPositions: {
    method: "GET",
    path: "/clients/positions",
    headers: tenantHeaders,
    responses: { 200: clientPositionsOutput },
    summary: "Posición de clientes (deudores geolocalizados) con su estado",
  },
});
