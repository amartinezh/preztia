import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";
import { planFrequency } from "./payment-plans";

const c = initContract();

export const creditStatus = z.enum(["PENDING", "ACTIVE", "SETTLED", "DEFAULTED", "CANCELLED"]);
export type CreditStatus = z.infer<typeof creditStatus>;

// Resumen de crédito para listados. El nombre del deudor (PII) es opcional y lo decide el
// backend; el cliente puede operar solo con identificadores y montos.
export const creditSummary = z.object({
  id: z.string().uuid(),
  borrowerId: z.string().uuid(),
  borrowerName: z.string().nullable(),
  zoneId: z.string().uuid(),
  zonePath: z.string().nullable(),
  principalMinor: z.number().int(),
  currency: z.string(),
  installmentsCount: z.number().int(),
  status: creditStatus,
  createdAt: z.string(),
});
export type CreditSummary = z.infer<typeof creditSummary>;

export const listCreditsOutput = z.object({
  items: z.array(creditSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// Entrada que valida la API en la frontera (zod).
// tenantId viene del header x-tenant-id y currency lo fija el servidor, por eso no van aquí.
export const grantCreditInput = z.object({
  borrowerId: z.string().uuid(),
  zoneId: z.string().uuid(),
  principalMinor: z.number().int().positive(),
  interestPct: z.number().nonnegative(),
  installmentsCount: z.number().int().positive(),
  // Plan de pago del que salieron los términos (opcional): registra el vínculo `payment_plan_id`.
  // Ausente en otorgamientos directos ("Personalizado"), igual que en los créditos del legado.
  paymentPlanId: z.string().uuid().optional(),
  // Periodicidad del cronograma. Ausente ⇒ el servidor usa DIARIO (retrocompatibilidad).
  frequency: planFrequency.optional(),
  // Teléfono WhatsApp del deudor (E.164 sin '+'): habilita el abono de pagos PIX.
  borrowerPhone: z.string().regex(/^\d{8,15}$/).optional(),
});
export type GrantCreditInput = z.infer<typeof grantCreditInput>;

export const grantCreditOutput = z.object({
  id: z.string().uuid(),
  installments: z.number().int(),
});
export type GrantCreditOutput = z.infer<typeof grantCreditOutput>;

// Contrato ts-rest: misma fuente de verdad para API (NestJS) y clientes (web/mobile).
export const creditContract = c.router({
  listCredits: {
    method: "GET",
    path: "/credits",
    headers: z.object({ "x-tenant-id": z.string().uuid() }),
    query: paginationQuery,
    responses: { 200: listCreditsOutput },
    summary: "Lista paginada de créditos dentro del alcance del usuario",
  },
  grantCredit: {
    method: "POST",
    path: "/credits",
    headers: z.object({ "x-tenant-id": z.string().uuid() }),
    body: grantCreditInput,
    responses: {
      201: grantCreditOutput,
    },
    summary: "Otorga un crédito a un deudor dentro de una zona",
  },
});
