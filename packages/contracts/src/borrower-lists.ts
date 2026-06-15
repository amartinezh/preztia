import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";
import { borrowerSummary } from "./borrowers";

const c = initContract();

// Contrato de LISTAS PERSONALIZADAS de clientes ("Listas Personalizadas" + "Filtros Clientes").
// El filtro reusa el listado de clientes (nationalId/name/withoutCredits); "agregar clientes del
// filtro a lista" es un alta masiva de miembros por `borrowerIds`.

export const borrowerListSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  memberCount: z.number().int(),
  createdAt: z.string(),
});
export type BorrowerListSummary = z.infer<typeof borrowerListSummary>;

export const listBorrowerListsOutput = z.object({ items: z.array(borrowerListSummary) });

export const createBorrowerListInput = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateBorrowerListInput = z.infer<typeof createBorrowerListInput>;

export const addListMembersInput = z.object({
  borrowerIds: z.array(z.string().uuid()).min(1),
});
export type AddListMembersInput = z.infer<typeof addListMembersInput>;

export const listMembersOutput = z.object({
  items: z.array(borrowerSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const memberParam = z.object({ id: z.string().uuid(), borrowerId: z.string().uuid() });

export const borrowerListsContract = c.router({
  listBorrowerLists: {
    method: "GET",
    path: "/borrower-lists",
    headers: tenantHeaders,
    responses: { 200: listBorrowerListsOutput },
    summary: "Listas personalizadas del tenant con su número de miembros",
  },
  createBorrowerList: {
    method: "POST",
    path: "/borrower-lists",
    headers: tenantHeaders,
    body: createBorrowerListInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Crea una lista personalizada",
  },
  deleteBorrowerList: {
    method: "DELETE",
    path: "/borrower-lists/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 204: z.null() },
    summary: "Elimina una lista personalizada",
  },
  listMembers: {
    method: "GET",
    path: "/borrower-lists/:id/members",
    pathParams: idParam,
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listMembersOutput },
    summary: "Clientes que pertenecen a la lista",
  },
  addListMembers: {
    method: "POST",
    path: "/borrower-lists/:id/members",
    pathParams: idParam,
    headers: tenantHeaders,
    body: addListMembersInput,
    responses: { 200: z.object({ added: z.number().int() }) },
    summary: "Agrega clientes a la lista (alta masiva idempotente)",
  },
  removeListMember: {
    method: "DELETE",
    path: "/borrower-lists/:id/members/:borrowerId",
    pathParams: memberParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 204: z.null() },
    summary: "Quita un cliente de la lista",
  },
});
