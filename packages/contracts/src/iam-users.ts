import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato del PLANO DE DATOS para usuarios del tenant (ADMIN/COORDINATOR). Lleva
// `x-tenant-id` (el JwtGuard exige que coincida con el claim). Los roles creables por API
// son COORDINATOR y COLLECTOR; el ADMIN se provisiona desde el plano de control.

export const userRole = z.enum(["SUPER_ADMIN", "ADMIN", "COORDINATOR", "COLLECTOR"]);
export type UserRole = z.infer<typeof userRole>;

export const creatableRole = z.enum(["COORDINATOR", "COLLECTOR"]);
export type CreatableRole = z.infer<typeof creatableRole>;

// Path ltree: segmentos [a-z0-9_] separados por punto.
const zonePath = z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/);

export const userSummary = z.object({
  id: z.string().uuid(),
  email: z.string(),
  /** Nombre visible de la persona (p. ej. "Ana Souza"); null en cuentas sin nombre configurado. */
  displayName: z.string().nullable(),
  role: userRole,
  zonePaths: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string(),
});
export type UserSummary = z.infer<typeof userSummary>;

export const listUsersOutput = z.object({
  items: z.array(userSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const displayName = z.string().trim().min(2).max(80);

export const createUserInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: creatableRole,
  zonePaths: z.array(zonePath).default([]),
  displayName: displayName.optional(),
});
export type CreateUserInput = z.infer<typeof createUserInput>;

export const updateUserInput = z
  .object({
    zonePaths: z.array(zonePath).optional(),
    active: z.boolean().optional(),
    displayName: displayName.nullable().optional(),
    /** Restablece la contraseña de un usuario del alcance (ADMIN/COORDINATOR): quien olvida su clave no pierde su cuenta. */
    password: z.string().min(8).optional(),
  })
  .refine(
    (v) =>
      v.zonePaths !== undefined ||
      v.active !== undefined ||
      v.displayName !== undefined ||
      v.password !== undefined,
    { message: "Nada que actualizar" },
  );

/** Cambio de la PROPIA contraseña: exige la actual (prueba de posesión) y una nueva distinta. */
export const changeMyPasswordInput = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: "La nueva contraseña debe ser distinta" });
export type ChangeMyPasswordInput = z.infer<typeof changeMyPasswordInput>;

// El `Authorization: Bearer` lo inyecta el fetcher del cliente; el contrato solo declara
// el `x-tenant-id` (que el JwtGuard exige que coincida con el claim).
const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

export const iamUsersContract = c.router({
  changeMyPassword: {
    method: "POST",
    path: "/me/password",
    headers: tenantHeaders,
    body: changeMyPasswordInput,
    responses: { 204: z.object({}) },
    summary: "Cambia la contraseña del usuario autenticado (exige la actual)",
  },
  listUsers: {
    method: "GET",
    path: "/users",
    headers: tenantHeaders,
    query: paginationQuery.extend({ role: userRole.optional() }),
    responses: { 200: listUsersOutput },
    summary: "Lista paginada de usuarios del tenant",
  },
  createUser: {
    method: "POST",
    path: "/users",
    headers: tenantHeaders,
    body: createUserInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Crea un usuario (coordinador/cobrador) dentro del alcance del actor",
  },
  updateUser: {
    method: "PATCH",
    path: "/users/:id",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    body: updateUserInput,
    responses: { 200: userSummary },
    summary: "Actualiza zonas/estado de un usuario",
  },
  deactivateUser: {
    method: "DELETE",
    path: "/users/:id",
    pathParams: z.object({ id: z.string().uuid() }),
    headers: tenantHeaders,
    body: z.object({}).optional(),
    responses: { 204: z.object({}) },
    summary: "Desactiva un usuario (no se borra: trazabilidad)",
  },
});
