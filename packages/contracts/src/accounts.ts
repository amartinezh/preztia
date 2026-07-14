import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";
import { creditStatus } from "./credit";

const c = initContract();

// Contrato del "Listado de Cuentas" y el "Detalle de préstamo" del legado: vista de cada
// crédito otorgado desde su cartera (deuda, cuotas pagas, días de atraso, valor de cuota). Es
// un read-model derivado; la escritura sigue por el slice de crédito/pagos.

export const accountFrequency = z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]);

// Fila del listado de cuentas. Dinero en unidades menores; nombre/cédula del cliente desde el
// registro `borrower` (PII servida bajo RLS y rol).
export const accountRow = z.object({
  creditId: z.string().uuid(),
  borrowerId: z.string().uuid(),
  borrowerName: z.string().nullable(),
  nationalId: z.string().nullable(),
  zonePath: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  /** Valor total a pagar (capital + interés). */
  totalDueMinor: z.number().int(),
  installmentsCount: z.number().int(),
  paidCount: z.number().int(),
  daysOverdue: z.number().int(),
  outstandingMinor: z.number().int(),
  /** Abonos aplicados HOY a esta cuenta ("Cobrado hoy"). */
  collectedTodayMinor: z.number().int(),
  /** Saldo de la(s) cuota(s) que vencen hoy ("Pago en Fecha"). */
  dueTodayMinor: z.number().int(),
  currency: z.string(),
  status: creditStatus,
});
export type AccountRow = z.infer<typeof accountRow>;

export const listAccountsOutput = z.object({
  items: z.array(accountRow),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const listAccountsQuery = paginationQuery.extend({
  name: z.string().trim().min(1).max(80).optional(),
  nationalId: z.string().trim().min(1).max(40).optional(),
  /** Búsqueda por teléfono del cliente (coincidencia parcial). */
  phone: z.string().trim().min(1).max(40).optional(),
  /** Solo cuentas con días de atraso > 0. */
  onlyOverdue: z.coerce.boolean().optional(),
});

const accountInstallment = z.object({
  seq: z.number().int(),
  dueDate: z.string(),
  amountDueMinor: z.number().int(),
  paidMinor: z.number().int(),
  status: z.enum(["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE"]),
});

// Cabecera + cronograma del detalle de préstamo.
export const accountDetail = z.object({
  creditId: z.string().uuid(),
  borrowerId: z.string().uuid(),
  borrowerName: z.string().nullable(),
  nationalId: z.string().nullable(),
  phone: z.string().nullable(),
  /** Nombre del plan de pago pactado (Fase 10); null en créditos sin plan asociado. */
  planName: z.string().nullable(),
  principalMinor: z.number().int(),
  interestPct: z.number().int(),
  installmentsCount: z.number().int(),
  frequency: accountFrequency,
  currency: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: creditStatus,
  totalDueMinor: z.number().int(),
  totalPaidMinor: z.number().int(),
  outstandingMinor: z.number().int(),
  paidCount: z.number().int(),
  daysOverdue: z.number().int(),
  /** Valor de la cuota representativa (la primera; la última absorbe el redondeo). */
  installmentValueMinor: z.number().int(),
  installments: z.array(accountInstallment),
});
export type AccountDetail = z.infer<typeof accountDetail>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const creditIdParam = z.object({ creditId: z.string().uuid() });

export const accountsContract = c.router({
  listAccounts: {
    method: "GET",
    path: "/accounts",
    headers: tenantHeaders,
    query: listAccountsQuery,
    responses: { 200: listAccountsOutput },
    summary: "Listado de cuentas (créditos) con deuda y días de atraso",
  },
  getAccountDetail: {
    method: "GET",
    path: "/accounts/:creditId",
    pathParams: creditIdParam,
    headers: tenantHeaders,
    responses: { 200: accountDetail },
    summary: "Detalle de un préstamo: cabecera + cronograma de cuotas",
  },
});
