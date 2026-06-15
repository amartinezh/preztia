import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato del PLANO DE CONTROL (SUPER_ADMIN). No lleva `x-tenant-id`: el super admin
// cruza tenants. La autorización la impone el SuperAdminGuard (rol del JWT) en el servidor.

export const tenantStatus = z.enum(["ACTIVE", "SUSPENDED"]);
export type TenantStatus = z.infer<typeof tenantStatus>;

export const tenantOutput = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: tenantStatus,
  createdAt: z.string(),
});
export type TenantOutput = z.infer<typeof tenantOutput>;

export const listTenantsOutput = z.object({
  items: z.array(tenantOutput),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// El slug es opcional: si falta, el servidor lo deriva del nombre.
export const createTenantInput = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(2)
    .max(40)
    .optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantInput>;

export const updateTenantInput = z
  .object({
    name: z.string().min(2).max(120).optional(),
    status: tenantStatus.optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, {
    message: "Nada que actualizar",
  });

// Provisión de un ADMIN para un tenant: el super admin NUNCA crea un usuario sin tenant.
export const createTenantAdminInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// Un admin existente de un tenant (read model del plano de control).
export const tenantAdminOutput = z.object({
  id: z.string().uuid(),
  email: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type TenantAdminOutput = z.infer<typeof tenantAdminOutput>;

export const listTenantAdminsOutput = z.object({
  items: z.array(tenantAdminOutput),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// Gestión de un admin existente: activar/desactivar (no se borra: trazabilidad) y/o
// restablecer la contraseña. Al menos un campo debe venir.
export const updateTenantAdminInput = z
  .object({
    active: z.boolean().optional(),
    password: z.string().min(8).optional(),
  })
  .refine((v) => v.active !== undefined || v.password !== undefined, {
    message: "Nada que actualizar",
  });
export type UpdateTenantAdminInput = z.infer<typeof updateTenantAdminInput>;

// El PLANO DE CONTROL no lleva `x-tenant-id`; el `Authorization: Bearer` lo inyecta el
// fetcher del cliente y el servidor lo valida con el SuperAdminGuard.
export const tenantsContract = c.router({
  listTenants: {
    method: "GET",
    path: "/admin/tenants",
    query: paginationQuery,
    responses: { 200: listTenantsOutput },
    summary: "Lista paginada de tenants (super admin)",
  },
  createTenant: {
    method: "POST",
    path: "/admin/tenants",
    body: createTenantInput,
    responses: { 201: z.object({ id: z.string().uuid(), slug: z.string() }) },
    summary: "Crea un tenant",
  },
  updateTenant: {
    method: "PATCH",
    path: "/admin/tenants/:id",
    pathParams: z.object({ id: z.string().uuid() }),
    body: updateTenantInput,
    responses: { 200: tenantOutput },
    summary: "Actualiza nombre/estado de un tenant",
  },
  deleteTenant: {
    method: "DELETE",
    path: "/admin/tenants/:id",
    pathParams: z.object({ id: z.string().uuid() }),
    body: z.object({}).optional(),
    responses: { 204: z.object({}) },
    summary: "Elimina un tenant",
  },
  createTenantAdmin: {
    method: "POST",
    path: "/admin/tenants/:id/admins",
    pathParams: z.object({ id: z.string().uuid() }),
    body: createTenantAdminInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Provisiona un ADMIN vinculado al tenant",
  },
  listTenantAdmins: {
    method: "GET",
    path: "/admin/tenants/:id/admins",
    pathParams: z.object({ id: z.string().uuid() }),
    query: paginationQuery,
    responses: { 200: listTenantAdminsOutput },
    summary: "Lista paginada de admins de un tenant",
  },
  updateTenantAdmin: {
    method: "PATCH",
    path: "/admin/tenants/:id/admins/:adminId",
    pathParams: z.object({ id: z.string().uuid(), adminId: z.string().uuid() }),
    body: updateTenantAdminInput,
    responses: { 200: tenantAdminOutput.omit({ createdAt: true }) },
    summary: "Activa/desactiva o restablece la contraseña de un admin",
  },
});
