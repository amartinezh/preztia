import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de GASTOS de cobro ("Solicitud Gastos"): el cobrador solicita; el ADMIN/COORDINATOR
// aprueba o rechaza (maker-checker). Aprobar debita el dinero de una caja/cuenta (asiento EXPENSE).

export const expenseStatus = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type ExpenseStatus = z.infer<typeof expenseStatus>;

export const expense = z.object({
  id: z.string().uuid(),
  requestedBy: z.string().uuid(),
  /** Email de quien lo pidió (para la bandeja del coordinador); null si ya no existe. */
  requesterEmail: z.string().nullable(),
  description: z.string(),
  amountMinor: z.number().int(),
  status: expenseStatus,
  /** Zona del gasto (la de la caja de ruta de quien lo pidió); null = gasto del tenant. */
  zoneId: z.string().uuid().nullable(),
  zoneName: z.string().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  paidFromCashBoxId: z.string().uuid().nullable(),
  /** ¿Tiene comprobante adjunto? (se descarga aparte, descifrado y sin caché). */
  hasReceipt: z.boolean(),
  /** Caja de ruta de quien lo pidió (opción de pago al aprobar); null si no tiene. */
  requesterRouteBox: z
    .object({ id: z.string().uuid(), name: z.string(), balanceMinor: z.number().int() })
    .nullable(),
  createdAt: z.string(),
});
export type Expense = z.infer<typeof expense>;

export const listExpensesOutput = z.object({
  items: z.array(expense),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// El alcance lo impone el servidor: el cobrador solo ve lo suyo; el coordinador, su subárbol.
export const listExpensesQuery = paginationQuery.extend({
  status: expenseStatus.optional(),
});

// Solicitud de gasto con su comprobante OBLIGATORIO: se envía como multipart/form-data con los
// campos de texto `description` y `amountMinor` (unidades menores) y el archivo `receipt` (foto o
// PDF). El servidor valida los campos con este esquema y el archivo con la regla del dominio.
export const createExpenseFields = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.coerce.number().int().positive(),
});
export type CreateExpenseFields = z.infer<typeof createExpenseFields>;

/** Nombre del campo del archivo en el multipart. */
export const EXPENSE_RECEIPT_FIELD = "receipt";

// Aprobar un gasto lo paga: exige la caja/cuenta de la que sale el dinero (asiento EXPENSE OUT).
// Rechazar no mueve dinero, pero exige el motivo (queda en el historial del cobrador).
export const reviewExpenseInput = z
  .object({
    approve: z.boolean(),
    paidFromCashBoxId: z.string().uuid().optional(),
    rejectionReason: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.approve && !v.paidFromCashBoxId) {
      ctx.addIssue({
        code: "custom",
        path: ["paidFromCashBoxId"],
        message: "Aprobar un gasto exige elegir la caja/cuenta pagadora",
      });
    }
    if (!v.approve && (v.rejectionReason ?? "").length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "Rechazar un gasto exige un motivo",
      });
    }
  });
export type ReviewExpenseInput = z.infer<typeof reviewExpenseInput>;

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
    contentType: "multipart/form-data",
    // FormData con `description`, `amountMinor` y el archivo `receipt` (ver createExpenseFields).
    body: c.type<FormData>(),
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Registra una solicitud de gasto con su comprobante (foto/PDF obligatorio)",
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
