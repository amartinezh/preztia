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

// Estados de un INTENTO de pago fallido/pendiente (para la vista de auditoría de pagos).
export const paymentStatusEnum = z.enum([
  "RECEIVED",
  "VERIFIED",
  "UNVERIFIED",
  "REJECTED_FRAUD",
  "REJECTED_INVALID",
]);
export type PaymentStatusContract = z.infer<typeof paymentStatusEnum>;

// Estado de la verificación bancaria (filtro de auditoría).
export const bankStatusEnum = z.enum(["CONFIRMED", "NOT_FOUND", "UNAVAILABLE"]);
export type BankStatusContract = z.infer<typeof bankStatusEnum>;

// Fecha de negocio (YYYY-MM-DD) para acotar rangos sin acoplar la zona horaria del cliente.
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)");

// Listado de intentos a nivel tenant (auditoría) con filtros avanzados.
// `failedOnly` filtra los no verificados; `q` busca en pagador/CPF/banco/E2E;
// el rango de monto/fecha acota la búsqueda. El servidor valida la frontera.
export const listPaymentAttemptsQuery = paginationQuery.extend({
  status: paymentStatusEnum.optional(),
  failedOnly: z.coerce.boolean().optional(),
  // Texto libre: nombre del pagador, CPF/CNPJ, banco emisor o end-to-end id.
  q: z.string().trim().min(1).max(80).optional(),
  bankStatus: bankStatusEnum.optional(),
  minAmountMinor: z.coerce.number().int().nonnegative().optional(),
  maxAmountMinor: z.coerce.number().int().nonnegative().optional(),
  // Rango de la fecha de pago del comprobante (inclusivo).
  fromDate: businessDate.optional(),
  toDate: businessDate.optional(),
});
export type ListPaymentAttemptsQuery = z.infer<typeof listPaymentAttemptsQuery>;

// Una entrada del proceso (bitácora append-only `payment_event`): qué pasó y cuándo.
export const paymentEventView = z.object({
  type: z.string(),
  payload: z.unknown().nullable(),
  createdAt: z.string(),
});
export type PaymentEventView = z.infer<typeof paymentEventView>;

// Detalle completo de un intento de pago para auditoría (coordinador/admin). Incluye PII completa
// (el revisor está autorizado), la extracción íntegra de la IA, la respuesta del banco y el proceso.
export const paymentDetail = z.object({
  id: z.string().uuid(),
  creditId: z.string().uuid().nullable(),
  status: paymentStatusEnum,
  amountMinor: z.number().int().nullable(),
  currency: z.string(),
  paidAt: z.string().nullable(),
  payerPhone: z.string(),
  payerName: z.string().nullable(),
  payerTaxId: z.string().nullable(),
  payerBankName: z.string().nullable(),
  receiverPixKey: z.string().nullable(),
  endToEndId: z.string().nullable(),
  txid: z.string().nullable(),
  // Verificación bancaria: estado + respuesta cruda del banco (por qué se confirmó/no).
  bankStatus: z.enum(["CONFIRMED", "NOT_FOUND", "UNAVAILABLE"]).nullable(),
  bankResponse: z.unknown().nullable(),
  verifiedAt: z.string().nullable(),
  reconciliationAttempts: z.number().int(),
  lastReconciliationAt: z.string().nullable(),
  // Metadata íntegra extraída por la IA del comprobante (campos variables por banco).
  extraction: z.record(z.unknown()).nullable(),
  // ¿Hay imagen del comprobante almacenada para abrir/zoom?
  hasReceipt: z.boolean(),
  mimeType: z.string().nullable(),
  createdAt: z.string(),
  // Motivo(s) por los que el intento fue marcado/no verificado (para el banner destacado).
  flagReasons: z.array(z.string()).nullable(),
  // Proceso completo (antifraude → verificación bancaria → decisión → validación manual).
  events: z.array(paymentEventView),
});
export type PaymentDetail = z.infer<typeof paymentDetail>;

// Validación MANUAL: el coordinador/admin hace efectivo el abono. Motivo OBLIGATORIO; puede
// corregir el monto si el OCR falló (por defecto usa el monto extraído).
export const manualVerifyPaymentInput = z.object({
  reason: z.string().trim().min(5).max(500),
  amountMinor: z.number().int().positive().optional(),
});
export type ManualVerifyPaymentInput = z.infer<typeof manualVerifyPaymentInput>;

export const manualVerifyPaymentOutput = z.object({
  id: z.string().uuid(),
  status: paymentStatusEnum,
  balanceMinor: z.number().int(),
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

// Registro de un abono en efectivo (cobro de ruta). El monto va en unidades menores enteras.
export const registerCashPaymentInput = z.object({
  amountMinor: z.number().int().positive(),
});
export type RegisterCashPaymentInput = z.infer<typeof registerCashPaymentInput>;

export const registerCashPaymentOutput = z.object({
  id: z.string().uuid(),
  creditId: z.string().uuid(),
  amountMinor: z.number().int(),
  balanceMinor: z.number().int(),
});

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
  registerCashPayment: {
    method: "POST",
    path: "/credits/:creditId/payments",
    pathParams: z.object({ creditId: z.string().uuid() }),
    headers: tenantHeaders,
    body: registerCashPaymentInput,
    responses: { 201: registerCashPaymentOutput },
    summary: "Registra un abono en efectivo (idempotente vía Idempotency-Key)",
  },
  reconcilePayments: {
    method: "POST",
    path: "/payments/reconcile",
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: reconcileOutput },
    summary: "Concilia contra el banco los pagos pendientes de verificación",
  },
  listPaymentAttempts: {
    method: "GET",
    path: "/payments",
    headers: tenantHeaders,
    query: listPaymentAttemptsQuery,
    responses: { 200: listPaymentsOutput },
    summary: "Listado de intentos de pago a nivel tenant (auditoría; filtrable por estado)",
  },
  getPaymentDetail: {
    method: "GET",
    path: "/payments/:paymentId",
    pathParams: z.object({ paymentId: z.string().uuid() }),
    headers: tenantHeaders,
    responses: { 200: paymentDetail },
    summary: "Detalle completo de un intento de pago (metadata IA + banco + proceso)",
  },
  manualVerifyPayment: {
    method: "POST",
    path: "/payments/:paymentId/manual-verification",
    pathParams: z.object({ paymentId: z.string().uuid() }),
    headers: tenantHeaders,
    body: manualVerifyPaymentInput,
    responses: { 200: manualVerifyPaymentOutput },
    summary: "Valida manualmente un pago (coordinador/admin) con motivo obligatorio: hace efectivo el abono",
  },
});
