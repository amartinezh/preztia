import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de GASTOS de cobro ("Solicitud Gastos"): el cobrador solicita; el ADMIN/COORDINATOR
// aprueba o rechaza (maker-checker). Solo los aprobados afectan la caja de la liquidada.

export const expenseStatus = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type ExpenseStatus = z.infer<typeof expenseStatus>;

export const expense = z.object({
  id: z.string().uuid(),
  requestedBy: z.string().uuid(),
  description: z.string(),
  amountMinor: z.number().int(),
  status: expenseStatus,
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Expense = z.infer<typeof expense>;

export const listExpensesOutput = z.object({
  items: z.array(expense),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const listExpensesQuery = paginationQuery.extend({
  status: expenseStatus.optional(),
});

export const createExpenseInput = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseInput>;

export const reviewExpenseInput = z.object({
  approve: z.boolean(),
});

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export const expensesContract = c.router({
  listExpenses: {
    method: "GET",
    path: "/expenses",
    headers: tenantHeaders,
    query: listExpensesQuery,
    responses: { 200: listExpensesOutput },
    summary: "Lista de gastos (filtrable por estado)",
  },
  createExpense: {
    method: "POST",
    path: "/expenses",
    headers: tenantHeaders,
    body: createExpenseInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Registra una solicitud de gasto (cobrador)",
  },
  reviewExpense: {
    method: "PATCH",
    path: "/expenses/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: reviewExpenseInput,
    responses: { 200: expense },
    summary: "Aprueba o rechaza un gasto (ADMIN/COORDINATOR)",
  },
});
