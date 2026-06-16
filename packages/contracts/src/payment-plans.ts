import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de PLANES DE PAGO por tenant (plantillas de crédito ofertables). Fuente única de
// tipos para API (NestJS) y cliente (Expo). Solo el ADMIN administra los planes. Interés en
// base-mil (200 = 20%), igual que el crédito; periodicidad espeja el enum `frequency` de BD.

export const planFrequency = z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]);
export type PlanFrequency = z.infer<typeof planFrequency>;

export const paymentPlanView = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  installmentsCount: z.number().int().min(1).max(365),
  frequency: planFrequency,
  interestPct: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
  isDefault: z.boolean(),
});
export type PaymentPlanView = z.infer<typeof paymentPlanView>;

// Alta: la marca de default es opcional (el server fuerza default si es el primer plan del tenant).
export const createPaymentPlanInput = z.object({
  name: z.string().min(1).max(80),
  installmentsCount: z.number().int().min(1).max(365),
  frequency: planFrequency,
  interestPct: z.number().int().min(0).max(1000),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type CreatePaymentPlanInput = z.infer<typeof createPaymentPlanInput>;

// Edición parcial: solo se aplican los campos presentes.
export const updatePaymentPlanInput = createPaymentPlanInput.partial();
export type UpdatePaymentPlanInput = z.infer<typeof updatePaymentPlanInput>;

export const listPaymentPlansOutput = z.object({
  items: z.array(paymentPlanView),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export const paymentPlansContract = c.router({
  list: {
    method: "GET",
    path: "/payment-plans",
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listPaymentPlansOutput },
    summary: "Lista paginada de planes de pago del tenant",
  },
  create: {
    method: "POST",
    path: "/payment-plans",
    headers: tenantHeaders,
    body: createPaymentPlanInput,
    responses: { 201: paymentPlanView },
    summary: "Crea un plan de pago (ADMIN)",
  },
  update: {
    method: "PATCH",
    path: "/payment-plans/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: updatePaymentPlanInput,
    responses: { 200: paymentPlanView },
    summary: "Actualiza un plan de pago, incluido activar/desactivar (ADMIN)",
  },
  setDefault: {
    method: "POST",
    path: "/payment-plans/:id/default",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: paymentPlanView },
    summary: "Marca un plan como el único por defecto del tenant (ADMIN)",
  },
  remove: {
    method: "DELETE",
    path: "/payment-plans/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 204: z.void() },
    summary: "Elimina un plan de pago no predeterminado (ADMIN)",
  },
});
