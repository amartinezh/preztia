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
  // Caja/cuenta de la que SALE el dinero: otorgar es desembolsar (el libro lo debita en la
  // misma transacción; sin saldo no hay crédito).
  fundingCashBoxId: z.string().uuid(),
});
export type GrantCreditInput = z.infer<typeof grantCreditInput>;

// CARGA DE UN CRÉDITO MIGRADO del sistema anterior (solo ADMIN): deuda que ya existe, con fecha de
// inicio pasada y sus abonos históricos. No sale dinero de ninguna caja ni entran hoy los abonos.
export const historicalPaymentInput = z.object({
  paidOn: z.string().date(),
  amountMinor: z.number().int().positive(),
});
export const registerMigratedCreditInput = z.object({
  borrowerId: z.string().uuid(),
  zoneId: z.string().uuid(),
  principalMinor: z.number().int().positive(),
  interestPct: z.number().int().min(0).max(1000),
  installmentsCount: z.number().int().min(1).max(365),
  frequency: planFrequency,
  startDate: z.string().date(),
  // Identificador en el sistema anterior (opcional): evita cargar dos veces el mismo crédito.
  legacyReference: z.string().trim().min(1).max(80).optional(),
  payments: z.array(historicalPaymentInput).max(500),
});
export type RegisterMigratedCreditInput = z.infer<typeof registerMigratedCreditInput>;

export const registerMigratedCreditOutput = z.object({
  id: z.string().uuid(),
  installments: z.number().int(),
  paidMinor: z.number().int(),
  balanceMinor: z.number().int(),
  settled: z.boolean(),
});

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
  registerMigratedCredit: {
    method: "POST",
    path: "/credits/migrated",
    headers: z.object({ "x-tenant-id": z.string().uuid() }),
    body: registerMigratedCreditInput,
    responses: { 201: registerMigratedCreditOutput },
    summary: "Carga un crédito del sistema anterior con sus abonos históricos, sin mover cajas (ADMIN)",
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
