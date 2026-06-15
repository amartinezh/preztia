import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de SOLICITUDES DE MODIFICACIÓN DE CLIENTE ("Solicitud Modificar Cliente"): el
// cobrador propone cambios a los datos de un cliente; el ADMIN/COORDINATOR aprueba (se aplican)
// o rechaza (maker-checker).

export const changeRequestStatus = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type ChangeRequestStatus = z.infer<typeof changeRequestStatus>;

// Subconjunto editable del cliente que una solicitud puede proponer (al menos un campo).
export const borrowerChanges = z
  .object({
    nationalId: z.string().trim().min(1).max(40),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80),
    business: z.string().trim().max(120).nullable(),
    phone: z.string().trim().min(5).max(20).nullable(),
  })
  .partial()
  .refine((c) => Object.keys(c).length > 0, {
    message: "Debes proponer al menos un cambio",
  });
export type BorrowerChanges = z.infer<typeof borrowerChanges>;

export const changeRequest = z.object({
  id: z.string().uuid(),
  borrowerId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  changes: z.record(z.string(), z.unknown()),
  status: changeRequestStatus,
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ChangeRequest = z.infer<typeof changeRequest>;

export const listChangeRequestsOutput = z.object({
  items: z.array(changeRequest),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const listChangeRequestsQuery = paginationQuery.extend({
  status: changeRequestStatus.optional(),
});

export const createChangeRequestInput = z.object({
  borrowerId: z.string().uuid(),
  changes: borrowerChanges,
});
export type CreateChangeRequestInput = z.infer<typeof createChangeRequestInput>;

export const reviewChangeRequestInput = z.object({ approve: z.boolean() });

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export const changeRequestsContract = c.router({
  listChangeRequests: {
    method: "GET",
    path: "/change-requests",
    headers: tenantHeaders,
    query: listChangeRequestsQuery,
    responses: { 200: listChangeRequestsOutput },
    summary: "Solicitudes de modificación de cliente (filtrable por estado)",
  },
  createChangeRequest: {
    method: "POST",
    path: "/change-requests",
    headers: tenantHeaders,
    body: createChangeRequestInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Propone un cambio de datos de un cliente (cobrador)",
  },
  reviewChangeRequest: {
    method: "PATCH",
    path: "/change-requests/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: reviewChangeRequestInput,
    responses: { 200: changeRequest },
    summary: "Aprueba (aplica) o rechaza una solicitud (ADMIN/COORDINATOR)",
  },
});
