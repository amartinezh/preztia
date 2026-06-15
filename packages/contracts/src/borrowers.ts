import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato del PLANO DE DATOS para el registro de CLIENTES (deudores) — la entidad "Cliente"
// del legado. CRUD + cupo (límite de crédito) + bloqueo de créditos + color + notas. El alcance
// (qué clientes ve cada actor) lo imponen el rol y el subárbol de zonas en el caso de uso.

// Espejo del enum `borrower_color` (BD) y del dominio: Ninguno/Amarillo/Azul/Rojo/Verde/Naranja.
export const borrowerColor = z.enum([
  "NONE",
  "YELLOW",
  "BLUE",
  "RED",
  "GREEN",
  "ORANGE",
]);
export type BorrowerColor = z.infer<typeof borrowerColor>;

// Resumen del cliente para listados (Listado/Cupo Clientes). Dinero en unidades menores.
export const borrowerSummary = z.object({
  id: z.string().uuid(),
  nationalId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  business: z.string().nullable(),
  phone: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  color: borrowerColor,
  creditBlocked: z.boolean(),
  creditLimitMinor: z.number().int(),
  createdAt: z.string(),
});
export type BorrowerSummary = z.infer<typeof borrowerSummary>;

export const listBorrowersOutput = z.object({
  items: z.array(borrowerSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// Filtros del listado (Cédula/Nombre del legado + "Mostrar solo clientes sin créditos").
export const listBorrowersQuery = paginationQuery.extend({
  nationalId: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  withoutCredits: z.coerce.boolean().optional(),
});

const phoneSchema = z.string().trim().min(5).max(20);

export const createBorrowerInput = z.object({
  nationalId: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).default(""),
  business: z.string().trim().max(120).nullable().default(null),
  phone: phoneSchema.nullable().default(null),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  color: borrowerColor.default("NONE"),
  creditBlocked: z.boolean().default(false),
  creditLimitMinor: z.number().int().nonnegative().default(0),
});
export type CreateBorrowerInput = z.infer<typeof createBorrowerInput>;

// Edición parcial: cubre tanto el formulario completo como las acciones rápidas del menú
// contextual del legado (Asignar Color, Créditos → Bloquear/Permitir, Cupo).
export const updateBorrowerInput = z
  .object({
    nationalId: z.string().trim().min(1).max(40),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80),
    business: z.string().trim().max(120).nullable(),
    phone: phoneSchema.nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    color: borrowerColor,
    creditBlocked: z.boolean(),
    creditLimitMinor: z.number().int().nonnegative(),
  })
  .partial();
export type UpdateBorrowerInput = z.infer<typeof updateBorrowerInput>;

// Notas de cobro del cliente (bitácora append-only).
export const borrowerNote = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  body: z.string(),
  createdAt: z.string(),
});
export type BorrowerNote = z.infer<typeof borrowerNote>;

export const listBorrowerNotesOutput = z.object({
  items: z.array(borrowerNote),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const addBorrowerNoteInput = z.object({
  body: z.string().trim().min(1).max(1000),
});

// El `Authorization: Bearer` lo inyecta el fetcher del cliente; solo se declara `x-tenant-id`.
const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export const borrowersContract = c.router({
  listBorrowers: {
    method: "GET",
    path: "/borrowers",
    headers: tenantHeaders,
    query: listBorrowersQuery,
    responses: { 200: listBorrowersOutput },
    summary: "Lista paginada de clientes dentro del alcance del usuario",
  },
  createBorrower: {
    method: "POST",
    path: "/borrowers",
    headers: tenantHeaders,
    body: createBorrowerInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Registra un cliente",
  },
  updateBorrower: {
    method: "PATCH",
    path: "/borrowers/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: updateBorrowerInput,
    responses: { 200: borrowerSummary },
    summary: "Edita un cliente (datos, color, cupo, bloqueo de créditos)",
  },
  listBorrowerNotes: {
    method: "GET",
    path: "/borrowers/:id/notes",
    pathParams: idParam,
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listBorrowerNotesOutput },
    summary: "Notas de cobro del cliente",
  },
  addBorrowerNote: {
    method: "POST",
    path: "/borrowers/:id/notes",
    pathParams: idParam,
    headers: tenantHeaders,
    body: addBorrowerNoteInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Agrega una nota de cobro al cliente",
  },
});
