import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato del PLANO DE DATOS para la asignación cobrador → clientes (COORDINATOR/ADMIN).
// El coordinador elige, de entre los clientes (deudores) dentro de su alcance, los que
// gestionará cada cobrador. El cobrador SOLO verá esos clientes.

// Cliente (deudor) candidato a asignar: identificador + datos mínimos de contacto.
export const assignableClient = z.object({
  borrowerId: z.string().uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  zonePath: z.string().nullable(),
  /** ¿Ya está asignado al cobrador consultado? (para precargar la selección) */
  assigned: z.boolean(),
});
export type AssignableClient = z.infer<typeof assignableClient>;

export const listAssignableClientsOutput = z.object({
  items: z.array(assignableClient),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const collectorClient = z.object({
  borrowerId: z.string().uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  zonePath: z.string().nullable(),
});
export type CollectorClient = z.infer<typeof collectorClient>;

export const listCollectorClientsOutput = z.object({
  items: z.array(collectorClient),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// Reemplaza el conjunto completo de clientes del cobrador.
export const assignClientsInput = z.object({
  borrowerIds: z.array(z.string().uuid()),
});

// El `Authorization: Bearer` lo inyecta el fetcher del cliente; solo se declara `x-tenant-id`.
const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const collectorsContract = c.router({
  listAssignableClients: {
    method: "GET",
    path: "/collectors/:id/assignable-clients",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listAssignableClientsOutput },
    summary: "Clientes dentro del alcance, marcando los ya asignados al cobrador",
  },
  assignClients: {
    method: "PUT",
    path: "/collectors/:id/clients",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    body: assignClientsInput,
    responses: { 200: z.object({ assigned: z.number().int() }) },
    summary: "Reemplaza la cartera de clientes del cobrador",
  },
  listMyClients: {
    method: "GET",
    path: "/me/clients",
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listCollectorClientsOutput },
    summary: "Clientes asignados al cobrador autenticado",
  },
});
