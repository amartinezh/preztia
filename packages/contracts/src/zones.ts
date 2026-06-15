import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato del PLANO DE DATOS para el árbol de zonas (ADMIN). El listado devuelve el árbol
// completo del tenant (ordenado por path) sin paginar: un tenant maneja decenas de zonas,
// no miles, y el cliente las pinta como árbol.

export const zoneNode = z.object({
  id: z.string().uuid(),
  parentZoneId: z.string().uuid().nullable(),
  path: z.string(),
  name: z.string(),
  coordinatorIds: z.array(z.string().uuid()),
  createdAt: z.string(),
});
export type ZoneNode = z.infer<typeof zoneNode>;

export const zoneTreeOutput = z.object({ items: z.array(zoneNode) });

export const createZoneInput = z.object({
  name: z.string().min(2).max(80),
  parentZoneId: z.string().uuid().nullable().default(null),
});
export type CreateZoneInput = z.infer<typeof createZoneInput>;

export const updateZoneInput = z.object({ name: z.string().min(2).max(80) });

export const assignCoordinatorInput = z.object({
  coordinatorId: z.string().uuid(),
});

// El `Authorization: Bearer` lo inyecta el fetcher del cliente; solo se declara `x-tenant-id`.
const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const zonesContract = c.router({
  listZones: {
    method: "GET",
    path: "/zones",
    headers: tenantHeaders,
    responses: { 200: zoneTreeOutput },
    summary: "Árbol de zonas del tenant",
  },
  createZone: {
    method: "POST",
    path: "/zones",
    headers: tenantHeaders,
    body: createZoneInput,
    responses: { 201: z.object({ id: z.string().uuid(), path: z.string() }) },
    summary: "Crea una zona (raíz o bajo un padre)",
  },
  updateZone: {
    method: "PATCH",
    path: "/zones/:id",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    body: updateZoneInput,
    responses: { 200: zoneNode },
    summary: "Renombra una zona (el path es estable)",
  },
  deleteZone: {
    method: "DELETE",
    path: "/zones/:id",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    body: z.object({}).optional(),
    responses: { 204: z.object({}) },
    summary: "Elimina una zona hoja",
  },
  assignCoordinator: {
    method: "POST",
    path: "/zones/:id/coordinators",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    body: assignCoordinatorInput,
    responses: { 204: z.object({}) },
    summary: "Vincula un coordinador a una zona",
  },
});
