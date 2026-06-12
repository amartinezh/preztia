import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

const MAX_PAGE_SIZE = 100;

// Paginación obligatoria en listados (atributo de calidad del sistema).
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

// Resumen de un pago para listados. El CPF/CNPJ del pagador viaja ENMASCARADO:
// la PII completa solo vive en la BD bajo RLS.
export const paymentSummary = z.object({
  id: z.string().uuid(),
  status: z.enum(["RECEIVED", "VERIFIED", "UNVERIFIED", "REJECTED_FRAUD", "REJECTED_INVALID"]),
  amountMinor: z.number().int().nullable(),
  currency: z.string(),
  paidAt: z.string().nullable(),
  payerName: z.string().nullable(),
  payerTaxIdMasked: z.string().nullable(),
  payerBankName: z.string().nullable(),
  endToEndId: z.string().nullable(),
  bankStatus: z.enum(["CONFIRMED", "NOT_FOUND", "UNAVAILABLE"]).nullable(),
  createdAt: z.string(),
});
export type PaymentSummary = z.infer<typeof paymentSummary>;

export const listPaymentsOutput = z.object({
  items: z.array(paymentSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const installmentSummary = z.object({
  seq: z.number().int(),
  dueDate: z.string(),
  amountDueMinor: z.number().int(),
  paidMinor: z.number().int(),
  status: z.enum(["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE"]),
});

export const portfolioOutput = z.object({
  creditId: z.string().uuid(),
  currency: z.string(),
  balanceMinor: z.number().int(),
  installments: z.array(installmentSummary),
});

export const reconcileOutput = z.object({
  processed: z.number().int(),
  verified: z.number().int(),
  stillPending: z.number().int(),
  flagged: z.number().int(),
});

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });

// Contrato ts-rest del slice de pagos: misma fuente de verdad para API y clientes.
export const paymentsContract = c.router({
  listCreditPayments: {
    method: "GET",
    path: "/credits/:creditId/payments",
    pathParams: z.object({ creditId: z.string().uuid() }),
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: listPaymentsOutput },
    summary: "Pagos registrados de un crédito (paginado)",
  },
  getCreditPortfolio: {
    method: "GET",
    path: "/credits/:creditId/portfolio",
    pathParams: z.object({ creditId: z.string().uuid() }),
    headers: tenantHeaders,
    responses: { 200: portfolioOutput },
    summary: "Cartera de cuotas y saldo de un crédito",
  },
  reconcilePayments: {
    method: "POST",
    path: "/payments/reconcile",
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: reconcileOutput },
    summary: "Concilia contra el banco los pagos pendientes de verificación",
  },
});
