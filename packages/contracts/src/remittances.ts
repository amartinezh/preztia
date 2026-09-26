import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de RENDICIÓN DE CUENTAS del cobrador (caja de ruta) y cierre de su deuda. El cobrador
// declara lo que entrega al volver de ruta; el coordinador cuenta y recibe (el dinero pasa de la
// caja de ruta a la caja de oficina en el libro). Lo no entregado queda como deuda arrastrada.
// Dinero en unidades menores. Ver docs/PLAN_CONTROL_CAMPO_Y_LIQUIDACION.md (Fase 2).

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

const MAX_NOTE_LENGTH = 500;
const MIN_REASON_LENGTH = 3;

export const remittanceObligationStatus = z.enum([
  "UP_TO_DATE",
  "PENDING",
  "LATE",
  "AWAITING_RECEPTION",
]);
export type RemittanceObligationStatus = z.infer<typeof remittanceObligationStatus>;

export const remittanceStatus = z.enum(["SUBMITTED", "RECEIVED"]);

/** Resumen del corte: "recogí X, gasté Y, entrego Z". */
export const remittanceSummary = z.object({
  openingMinor: z.number().int(),
  collectedMinor: z.number().int(),
  expensesMinor: z.number().int(),
  transferredOutMinor: z.number().int(),
  debtClosedMinor: z.number().int(),
  otherInMinor: z.number().int(),
  otherOutMinor: z.number().int(),
  expectedMinor: z.number().int(),
});
export type RemittanceSummary = z.infer<typeof remittanceSummary>;

export const remittanceView = z.object({
  id: z.string().uuid(),
  collectorId: z.string().uuid(),
  cashBoxId: z.string().uuid(),
  status: remittanceStatus,
  businessDate: z.string(),
  /** Límite que tenía la obligación al declarar; null si declaró sin cobros pendientes. */
  dueAt: z.string().nullable(),
  submittedAt: z.string(),
  /** Minutos de atraso al declarar (0 si fue a tiempo). */
  lateMinutesAtSubmission: z.number().int(),
  summary: remittanceSummary,
  declaredMinor: z.number().int(),
  collectorNote: z.string().nullable(),
  receivedAt: z.string().nullable(),
  receivedBy: z.string().uuid().nullable(),
  destinationCashBoxId: z.string().uuid().nullable(),
  expectedAtReceptionMinor: z.number().int().nullable(),
  countedMinor: z.number().int().nullable(),
  shortfallMinor: z.number().int().nullable(),
  closingBalanceMinor: z.number().int().nullable(),
  receiverNote: z.string().nullable(),
});
export type RemittanceView = z.infer<typeof remittanceView>;

/** Estado de la obligación del cobrador en este momento. */
const obligationFields = {
  status: remittanceObligationStatus,
  /** Instante límite para declarar; null si no hay obligación o ya declaró. */
  dueAt: z.string().nullable(),
  lateMinutes: z.number().int(),
  /** Efectivo en su poder (saldo de la caja de ruta). */
  cashInHandMinor: z.number().int(),
  /** Deuda arrastrada del último corte (menos cierres posteriores). */
  carriedDebtMinor: z.number().int(),
  currency: z.string(),
};

// Vista del cobrador: su caja, lo que va del período y su rendición abierta.
export const myRemittanceOutput = z.object({
  /** false si no tiene caja de ruta (no maneja efectivo). */
  hasRouteBox: z.boolean(),
  ...obligationFields,
  deadlineHourLocal: z.number().int(),
  summary: remittanceSummary,
  openRemittance: remittanceView.nullable(),
});
export type MyRemittanceOutput = z.infer<typeof myRemittanceOutput>;

export const submitRemittanceInput = z.object({
  declaredMinor: z.number().int().nonnegative(),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
});
export type SubmitRemittanceInput = z.infer<typeof submitRemittanceInput>;

export const receiveRemittanceInput = z.object({
  countedMinor: z.number().int().nonnegative(),
  /** Caja de oficina (efectivo) que recibe lo contado; obligatoria si se cuenta algo. */
  destinationCashBoxId: z.string().uuid().optional(),
  note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
});
export type ReceiveRemittanceInput = z.infer<typeof receiveRemittanceInput>;

// Tablero del coordinador: una fila por caja de ruta dentro de su alcance.
export const remittanceBoardRow = z.object({
  collectorId: z.string().uuid(),
  collectorEmail: z.string().nullable(),
  cashBoxId: z.string().uuid(),
  cashBoxName: z.string(),
  zoneId: z.string().uuid().nullable(),
  zoneName: z.string().nullable(),
  ...obligationFields,
  openRemittance: remittanceView.nullable(),
});
export type RemittanceBoardRow = z.infer<typeof remittanceBoardRow>;

export const remittanceBoardQuery = paginationQuery.extend({
  /** Solo cobradores con deuda arrastrada (reporte para nómina). */
  withDebt: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const remittanceBoardOutput = z.object({
  items: z.array(remittanceBoardRow),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const remittanceHistoryQuery = paginationQuery.extend({
  collectorId: z.string().uuid().optional(),
});

export const remittanceHistoryOutput = z.object({
  items: z.array(remittanceView),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const debtClosureType = z.enum(["PAYROLL", "WRITE_OFF"]);
export type DebtClosureType = z.infer<typeof debtClosureType>;

export const closeDebtInput = z.object({
  type: debtClosureType,
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(MIN_REASON_LENGTH).max(MAX_NOTE_LENGTH),
});
export type CloseDebtInput = z.infer<typeof closeDebtInput>;

export const closeDebtOutput = z.object({
  transactionId: z.string().uuid(),
  carriedDebtMinor: z.number().int(),
});

export const remittancesContract = c.router({
  getMyRemittance: {
    method: "GET",
    path: "/me/remittance",
    headers: tenantHeaders,
    responses: { 200: myRemittanceOutput },
    summary: "Estado de la rendición del cobrador autenticado: efectivo, deuda, período y atraso",
  },
  submitMyRemittance: {
    method: "POST",
    path: "/me/remittances",
    headers: tenantHeaders,
    body: submitRemittanceInput,
    responses: { 201: remittanceView },
    summary: "El cobrador declara lo que entrega al volver de ruta (idempotente vía Idempotency-Key)",
  },
  listMyRemittances: {
    method: "GET",
    path: "/me/remittances",
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: remittanceHistoryOutput },
    summary: "Historial de rendiciones del cobrador autenticado",
  },
  getRemittanceBoard: {
    method: "GET",
    path: "/remittances/board",
    headers: tenantHeaders,
    query: remittanceBoardQuery,
    responses: { 200: remittanceBoardOutput },
    summary: "Tablero de rendiciones por cobrador: pendientes, atrasos, por recibir y deuda (ADMIN/COORDINATOR)",
  },
  listRemittances: {
    method: "GET",
    path: "/remittances",
    headers: tenantHeaders,
    query: remittanceHistoryQuery,
    responses: { 200: remittanceHistoryOutput },
    summary: "Historial de rendiciones dentro del alcance (ADMIN/COORDINATOR)",
  },
  receiveRemittance: {
    method: "POST",
    path: "/remittances/:id/receive",
    pathParams: idParam,
    headers: tenantHeaders,
    body: receiveRemittanceInput,
    responses: { 200: remittanceView },
    summary: "El coordinador cuenta y recibe la rendición; el faltante queda como deuda",
  },
  closeCollectorDebt: {
    method: "POST",
    path: "/collectors/:id/debt-closures",
    pathParams: idParam,
    headers: tenantHeaders,
    body: closeDebtInput,
    responses: { 201: closeDebtOutput },
    summary: "Cierra deuda del cobrador por nómina o condonación (solo ADMIN)",
  },
});
