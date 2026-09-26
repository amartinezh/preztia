import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de ÓRDENES DE RUTA. El sistema propone clientes que necesitan visita en una zona
// (ordenados por recorrido); el coordinador reparte las paradas entre cobradores y despacha. El
// cobrador ve una VISTA MÍNIMA de cada parada mientras está abierta y la liquida con un resultado.
// `/routes` ya es la "lista de cobros" del legado: esto vive en `/collection-routes`.
// Dinero en unidades menores. Ver docs/PLAN_CONTROL_CAMPO_Y_LIQUIDACION.md (Fase 5).

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const MAX_TEXT = 500;
const ISO_DATE = z.string().date();

export const stopStatus = z.enum(["ASSIGNED", "SEEN", "RESOLVED", "CANCELLED"]);
export type StopStatus = z.infer<typeof stopStatus>;
export const stopOutcome = z.enum(["PAID", "NOT_PAID", "PROMISE", "NOT_FOUND"]);
export type StopOutcome = z.infer<typeof stopOutcome>;

/** Parada propuesta (cliente que necesita visita), en el orden del recorrido. */
export const proposedStop = z.object({
  creditId: z.string().uuid(),
  borrowerId: z.string().uuid(),
  clientName: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  overdueCount: z.number().int(),
  amountToCollectMinor: z.number().int(),
  currency: z.string(),
  /** ¿Ya tiene una parada abierta? (no se puede despachar de nuevo). */
  alreadyDispatched: z.boolean(),
});
export type ProposedStop = z.infer<typeof proposedStop>;

export const routeProposalOutput = z.object({
  items: z.array(proposedStop),
  /** true si el optimizador no respondió y el orden es por mora. */
  degraded: z.boolean(),
});

export const dispatchRouteInput = z.object({
  zoneId: z.string().uuid(),
  /** En el orden de visita; cada parada con su cobrador. */
  stops: z
    .array(z.object({ creditId: z.string().uuid(), collectorId: z.string().uuid() }))
    .min(1)
    .max(200),
});
export type DispatchRouteInput = z.infer<typeof dispatchRouteInput>;

/** Parada vista por el coordinador (con el cobrador y el resultado). */
export const reviewerStop = z.object({
  id: z.string().uuid(),
  sequence: z.number().int(),
  status: stopStatus,
  collectorId: z.string().uuid(),
  collectorEmail: z.string().nullable(),
  clientName: z.string(),
  address: z.string().nullable(),
  amountToCollectMinor: z.number().int(),
  currency: z.string(),
  dispatchedAt: z.string(),
  seenAt: z.string().nullable(),
  outcome: stopOutcome.nullable(),
  collectedMinor: z.number().int().nullable(),
  outcomeReason: z.string().nullable(),
  promiseDate: z.string().nullable(),
  note: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
});
export type ReviewerStop = z.infer<typeof reviewerStop>;

export const routeSummary = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid(),
  zoneName: z.string().nullable(),
  serviceDate: z.string(),
  dispatchedAt: z.string(),
  createdBy: z.string().uuid(),
  totalStops: z.number().int(),
  openStops: z.number().int(),
  resolvedStops: z.number().int(),
  collectedMinor: z.number().int(),
  currency: z.string(),
});
export type RouteSummary = z.infer<typeof routeSummary>;

export const routeDetail = routeSummary.extend({ stops: z.array(reviewerStop) });
export type RouteDetail = z.infer<typeof routeDetail>;

export const routesPage = z.object({
  items: z.array(routeSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

/**
 * Parada vista por el COBRADOR. Mientras está abierta trae la vista mínima (nombre, dirección,
 * mapa, teléfono, monto a cobrar); cerrada, el servidor anula dirección, teléfono y coordenadas.
 * Nunca incluye saldo total, historial del crédito ni paradas de otros cobradores.
 */
export const myRouteStop = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  serviceDate: z.string(),
  sequence: z.number().int(),
  status: stopStatus,
  clientName: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  amountToCollectMinor: z.number().int(),
  currency: z.string(),
  dispatchedAt: z.string(),
  outcome: stopOutcome.nullable(),
  collectedMinor: z.number().int().nullable(),
  resolvedAt: z.string().nullable(),
});
export type MyRouteStop = z.infer<typeof myRouteStop>;

export const myRouteStopsQuery = paginationQuery.extend({
  status: z.enum(["open", "done"]).default("open"),
});

export const myRouteStopsPage = z.object({
  items: z.array(myRouteStop),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const resolveStopInput = z.object({
  outcome: stopOutcome,
  /** Solo en PAID: lo cobrado en efectivo (entra a la caja de ruta de quien cobró). */
  collectedMinor: z.number().int().positive().optional(),
  /** Obligatorio en NOT_PAID. */
  reason: z.string().trim().max(MAX_TEXT).optional(),
  /** Obligatoria en PROMISE (YYYY-MM-DD, de hoy en adelante). */
  promiseDate: ISO_DATE.optional(),
  note: z.string().trim().max(MAX_TEXT).optional(),
});
export type ResolveStopInput = z.infer<typeof resolveStopInput>;

export const cancelStopInput = z.object({ reason: z.string().trim().min(3).max(MAX_TEXT) });

export const collectionRoutesContract = c.router({
  getRouteProposal: {
    method: "GET",
    path: "/collection-routes/proposal",
    headers: tenantHeaders,
    query: z.object({ zoneId: z.string().uuid() }),
    responses: { 200: routeProposalOutput },
    summary: "Propuesta de ruta: clientes de la zona que necesitan visita, en orden de recorrido",
  },
  dispatchRoute: {
    method: "POST",
    path: "/collection-routes",
    headers: tenantHeaders,
    body: dispatchRouteInput,
    responses: { 201: routeDetail },
    summary: "Despacha la ruta: cada parada queda asignada a su cobrador con fecha y hora",
  },
  // Nombre propio: `listRoutes` ya es la "lista de cobros" del legado (el cliente une los contratos).
  listCollectionRoutes: {
    method: "GET",
    path: "/collection-routes",
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: routesPage },
    summary: "Rutas despachadas dentro del alcance, con su avance",
  },
  getCollectionRoute: {
    method: "GET",
    path: "/collection-routes/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    responses: { 200: routeDetail },
    summary: "Detalle de una ruta con el estado y resultado de cada parada",
  },
  cancelRouteStop: {
    method: "POST",
    path: "/route-stops/:id/cancel",
    pathParams: idParam,
    headers: tenantHeaders,
    body: cancelStopInput,
    responses: { 200: reviewerStop },
    summary: "El coordinador cancela una parada abierta, con motivo",
  },
  listMyRouteStops: {
    method: "GET",
    path: "/me/route-stops",
    headers: tenantHeaders,
    query: myRouteStopsQuery,
    responses: { 200: myRouteStopsPage },
    summary: "Paradas del cobrador: abiertas (vista mínima) o su historial",
  },
  markRouteStopSeen: {
    method: "POST",
    path: "/me/route-stops/:id/seen",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: myRouteStop },
    summary: "El cobrador abrió la parada",
  },
  resolveRouteStop: {
    method: "POST",
    path: "/me/route-stops/:id/resolve",
    pathParams: idParam,
    headers: tenantHeaders,
    body: resolveStopInput,
    responses: { 200: myRouteStop },
    summary: "El cobrador liquida la visita: pagó (con monto), no pagó, promesa o no encontrado",
  },
});
