import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de ÓRDENES DE CONSIGNACIÓN al cobrador. El coordinador ordena depositar efectivo de la
// caja de ruta en una cuenta PIX; el cobrador reporta con comprobante; el coordinador verifica
// contra el banco u objeta. Toda la conversación queda en una bitácora append-only.
// Dinero en unidades menores. Ver docs/PLAN_CONTROL_CAMPO_Y_LIQUIDACION.md (Fase 4).

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const MAX_TEXT = 500;
const MIN_REASON = 3;

export const fieldOrderStatus = z.enum(["ISSUED", "SEEN", "REPORTED", "DISPUTED", "VERIFIED", "CANCELLED"]);
export type FieldOrderStatus = z.infer<typeof fieldOrderStatus>;

export const depositOrder = z.object({
  id: z.string().uuid(),
  status: fieldOrderStatus,
  collectorId: z.string().uuid(),
  collectorEmail: z.string().nullable(),
  zoneId: z.string().uuid().nullable(),
  zoneName: z.string().nullable(),
  routeCashBoxId: z.string().uuid(),
  destinationCashBoxId: z.string().uuid(),
  destinationName: z.string(),
  amountMinor: z.number().int(),
  instructions: z.string().nullable(),
  issuedBy: z.string().uuid(),
  issuedAt: z.string(),
  reportedAmountMinor: z.number().int().nullable(),
  depositedAt: z.string().nullable(),
  depositReference: z.string().nullable(),
  hasReceipt: z.boolean(),
  reportedAt: z.string().nullable(),
  verifiedBy: z.string().uuid().nullable(),
  verifiedAt: z.string().nullable(),
  verifiedAmountMinor: z.number().int().nullable(),
  /** Ingreso bancario enlazado al verificar (anti doble ingreso); null si se verificó sin él. */
  bankCreditId: z.string().uuid().nullable(),
  currency: z.string(),
});
export type DepositOrder = z.infer<typeof depositOrder>;

export const depositOrdersPage = z.object({
  items: z.array(depositOrder),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const listDepositOrdersQuery = paginationQuery.extend({
  status: fieldOrderStatus.optional(),
  collectorId: z.string().uuid().optional(),
});

export const issueDepositOrderInput = z.object({
  collectorId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  /** Caja BANK (cuenta PIX) donde debe consignar. */
  destinationCashBoxId: z.string().uuid(),
  instructions: z.string().trim().max(MAX_TEXT).optional(),
});
export type IssueDepositOrderInput = z.infer<typeof issueDepositOrderInput>;

// Reporte del cobrador: multipart con `amountMinor`, `depositedAt` (ISO), `reference` y `note`
// opcionales, y el archivo `receipt` (foto o PDF, obligatorio).
export const reportDepositFields = z.object({
  amountMinor: z.coerce.number().int().positive(),
  depositedAt: z.string().datetime({ offset: true }),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(MAX_TEXT).optional(),
});
export type ReportDepositFields = z.infer<typeof reportDepositFields>;
export const DEPOSIT_RECEIPT_FIELD = "receipt";

export const verifyDepositInput = z.object({
  verifiedAmountMinor: z.number().int().positive(),
  /** Ingreso bancario que corresponde al depósito (queda consumido por la orden). */
  bankCreditId: z.string().uuid().optional(),
  note: z.string().trim().max(MAX_TEXT).optional(),
});
export type VerifyDepositInput = z.infer<typeof verifyDepositInput>;

export const reasonInput = z.object({ reason: z.string().trim().min(MIN_REASON).max(MAX_TEXT) });
export const commentInput = z.object({ message: z.string().trim().min(1).max(MAX_TEXT) });

export const fieldOrderEventType = z.enum(["ISSUED", "SEEN", "REPORTED", "DISPUTED", "VERIFIED", "CANCELLED", "COMMENT"]);
export const fieldOrderEvent = z.object({
  id: z.string().uuid(),
  type: fieldOrderEventType,
  actorId: z.string().uuid(),
  actorEmail: z.string().nullable(),
  message: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type FieldOrderEvent = z.infer<typeof fieldOrderEvent>;
export const fieldOrderEventsOutput = z.object({ items: z.array(fieldOrderEvent) });

/** Ingreso bancario candidato a ser el depósito (monto exacto, cerca de la hora reportada). */
export const bankCreditMatch = z.object({
  id: z.string().uuid(),
  amountMinor: z.number().int(),
  receivedAt: z.string(),
  endToEndId: z.string().nullable(),
});
export const bankCreditMatchesOutput = z.object({ items: z.array(bankCreditMatch) });

export const depositOrdersContract = c.router({
  issueDepositOrder: {
    method: "POST",
    path: "/deposit-orders",
    headers: tenantHeaders,
    body: issueDepositOrderInput,
    responses: { 201: depositOrder },
    summary: "El coordinador ordena al cobrador consignar efectivo en una cuenta PIX",
  },
  listDepositOrders: {
    method: "GET",
    path: "/deposit-orders",
    headers: tenantHeaders,
    query: listDepositOrdersQuery,
    responses: { 200: depositOrdersPage },
    summary: "Órdenes de consignación dentro del alcance (ADMIN/COORDINATOR)",
  },
  listMyDepositOrders: {
    method: "GET",
    path: "/me/deposit-orders",
    headers: tenantHeaders,
    query: listDepositOrdersQuery.omit({ collectorId: true }),
    responses: { 200: depositOrdersPage },
    summary: "Órdenes de consignación del cobrador autenticado (con su historial)",
  },
  markDepositOrderSeen: {
    method: "POST",
    path: "/me/deposit-orders/:id/seen",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: depositOrder },
    summary: "El cobrador abrió la orden (queda 'vista' en la bitácora)",
  },
  reportDeposit: {
    method: "POST",
    path: "/me/deposit-orders/:id/report",
    pathParams: idParam,
    headers: tenantHeaders,
    contentType: "multipart/form-data",
    body: c.type<FormData>(),
    responses: { 200: depositOrder },
    summary: "El cobrador reporta el depósito con comprobante obligatorio",
  },
  verifyDeposit: {
    method: "POST",
    path: "/deposit-orders/:id/verify",
    pathParams: idParam,
    headers: tenantHeaders,
    body: verifyDepositInput,
    responses: { 200: depositOrder },
    summary: "El coordinador verifica: el efectivo pasa de la caja de ruta a la cuenta",
  },
  disputeDeposit: {
    method: "POST",
    path: "/deposit-orders/:id/dispute",
    pathParams: idParam,
    headers: tenantHeaders,
    body: reasonInput,
    responses: { 200: depositOrder },
    summary: "El coordinador objeta el reporte con motivo (el cobrador puede reportar de nuevo)",
  },
  cancelDepositOrder: {
    method: "POST",
    path: "/deposit-orders/:id/cancel",
    pathParams: idParam,
    headers: tenantHeaders,
    body: reasonInput,
    responses: { 200: depositOrder },
    summary: "El coordinador cancela la orden con motivo",
  },
  commentDepositOrder: {
    method: "POST",
    path: "/deposit-orders/:id/comments",
    pathParams: idParam,
    headers: tenantHeaders,
    body: commentInput,
    responses: { 201: fieldOrderEvent },
    summary: "Comentario en la bitácora de la orden (cobrador dueño o coordinador del alcance)",
  },
  listDepositOrderEvents: {
    method: "GET",
    path: "/deposit-orders/:id/events",
    pathParams: idParam,
    headers: tenantHeaders,
    responses: { 200: fieldOrderEventsOutput },
    summary: "Bitácora completa de la orden, en orden cronológico",
  },
  listDepositBankMatches: {
    method: "GET",
    path: "/deposit-orders/:id/bank-matches",
    pathParams: idParam,
    headers: tenantHeaders,
    responses: { 200: bankCreditMatchesOutput },
    summary: "Ingresos bancarios libres que pueden ser el depósito (sugerencia para verificar)",
  },
});
