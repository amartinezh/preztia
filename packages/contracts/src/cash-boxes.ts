import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de CAJAS y CUENTAS BANCARIAS. Clasificación de cajas (efectivo / bancaria /
// tránsito), CRUD de cuentas bancarias (solo ADMIN), libro de movimientos con filtros y
// dashboard financiero. Dinero en unidades menores; el secreto `apiKey` NUNCA se devuelve.

export const cashBoxType = z.enum(["CASH", "BANK", "TRANSIT"]);
export type CashBoxType = z.infer<typeof cashBoxType>;

export const cashTxDirection = z.enum(["IN", "OUT"]);
export const cashTxKind = z.enum([
  "PAYMENT_IN",
  "WITHDRAWAL",
  "EXPENSE",
  "TRANSFER",
  "ADJUSTMENT",
  "UNIDENTIFIED",
]);

// --- Cuentas bancarias ------------------------------------------------------

// Vista de una cuenta. `apiKey` es secreto: se expone solo `hasApiKey` (booleano).
export const bankAccount = z.object({
  id: z.string().uuid(),
  label: z.string(),
  bankName: z.string(),
  accountNumber: z.string().nullable(),
  countryCode: z.string(),
  bankCode: z.string(),
  pixKey: z.string().nullable(),
  hasApiKey: z.boolean(),
  unverifiedPolicy: z.enum(["HOLD", "ALLOCATE"]),
  active: z.boolean(),
  createdAt: z.string(),
});
export type BankAccount = z.infer<typeof bankAccount>;

export const listBankAccountsOutput = z.object({ items: z.array(bankAccount) });

export const bankAccountInput = z.object({
  label: z.string().trim().min(1).max(80),
  bankName: z.string().trim().min(1).max(80),
  accountNumber: z.string().trim().min(1).max(60).optional(),
  countryCode: z.string().trim().length(2).toUpperCase(),
  bankCode: z.string().trim().min(1).max(40).toUpperCase(),
  pixKey: z.string().trim().min(1).max(140).optional(),
  apiKey: z.string().trim().min(1).max(400).optional(),
  unverifiedPolicy: z.enum(["HOLD", "ALLOCATE"]).optional(),
});
export type BankAccountInput = z.infer<typeof bankAccountInput>;

// En edición todo es opcional (PATCH parcial). `apiKey: null` borra la credencial.
export const bankAccountPatch = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  bankName: z.string().trim().min(1).max(80).optional(),
  accountNumber: z.string().trim().min(1).max(60).nullable().optional(),
  pixKey: z.string().trim().min(1).max(140).nullable().optional(),
  apiKey: z.string().trim().min(1).max(400).nullable().optional(),
  unverifiedPolicy: z.enum(["HOLD", "ALLOCATE"]).optional(),
  active: z.boolean().optional(),
});

// --- Cajas ------------------------------------------------------------------

export const cashBox = z.object({
  id: z.string().uuid(),
  type: cashBoxType,
  name: z.string(),
  currency: z.string(),
  bankAccountId: z.string().uuid().nullable(),
  /** Cobrador dueño de la caja de ruta; null = caja de oficina/menor o no asignada. */
  assignedTo: z.string().uuid().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type CashBox = z.infer<typeof cashBox>;

export const listCashBoxesOutput = z.object({ items: z.array(cashBox) });

// Crear caja: BANK exige bankAccountId; CASH/TRANSIT lo prohíben (espejo del CHECK en BD).
// assignedTo (cobrador de ruta) solo es válido para cajas CASH.
export const createCashBoxInput = z
  .object({
    type: cashBoxType,
    name: z.string().trim().min(1).max(80),
    bankAccountId: z.string().uuid().optional(),
    assignedTo: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "BANK" && !v.bankAccountId) {
      ctx.addIssue({ code: "custom", path: ["bankAccountId"], message: "Una caja bancaria exige una cuenta vinculada" });
    }
    if (v.type !== "BANK" && v.bankAccountId) {
      ctx.addIssue({ code: "custom", path: ["bankAccountId"], message: "Solo las cajas bancarias se vinculan a una cuenta" });
    }
    if (v.type !== "CASH" && v.assignedTo) {
      ctx.addIssue({ code: "custom", path: ["assignedTo"], message: "Solo una caja de efectivo se asigna a un cobrador" });
    }
  });
export type CreateCashBoxInput = z.infer<typeof createCashBoxInput>;

// Editar caja: nombre/estado y reasignación de cobrador (assignedTo: null lo desvincula).
// El tipo y la cuenta son inmutables: protegen el libro mayor.
export const updateCashBoxInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});
export type UpdateCashBoxInput = z.infer<typeof updateCashBoxInput>;

// --- Movimientos ------------------------------------------------------------

// Retiro/egreso (Req 6): el motivo es obligatorio.
export const registerWithdrawalInput = z.object({
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3).max(280),
});

// Ingreso/egreso manual de la caja menor (Req 4): motivo obligatorio.
export const registerCashMovementInput = z.object({
  direction: cashTxDirection,
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3).max(280),
});

// Transferencia entre cajas (p. ej. clasificar fondos de tránsito a su caja real).
export const transferInput = z.object({
  fromBoxId: z.string().uuid(),
  toBoxId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3).max(280),
});

export const cashTransactionRow = z.object({
  id: z.string().uuid(),
  cashBoxId: z.string().uuid(),
  boxName: z.string(),
  direction: cashTxDirection,
  kind: cashTxKind,
  amountMinor: z.number().int(),
  currency: z.string(),
  reason: z.string().nullable(),
  paymentId: z.string().uuid().nullable(),
  transferGroupId: z.string().uuid().nullable(),
  /** null = asiento generado por el sistema (ruteo automático de un pago). */
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type CashTransactionRow = z.infer<typeof cashTransactionRow>;

export const listCashTransactionsOutput = z.object({
  items: z.array(cashTransactionRow),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

// Historial detallado con filtros (Req 5): por caja, tipo, sentido, usuario y rango de fechas.
// `userId` filtra por quien REGISTRÓ el asiento; `collectorId`, por el cobrador DUEÑO de la caja
// (su efectivo de ruta), aunque el asiento lo haya registrado otro o el sistema.
export const listCashTransactionsQuery = paginationQuery.extend({
  cashBoxId: z.string().uuid().optional(),
  kind: cashTxKind.optional(),
  direction: cashTxDirection.optional(),
  userId: z.string().uuid().optional(),
  collectorId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// --- Dashboard --------------------------------------------------------------

export const bankSyncStatus = z.enum(["MATCHED", "MISMATCH", "UNAVAILABLE"]);

// Última conciliación bancaria conocida de una caja (para resaltar descuadres en el dashboard).
export const lastReconciliation = z.object({
  status: bankSyncStatus,
  differenceMinor: z.number().int().nullable(),
  /** Saldo real reportado por el banco en esa sync; null si UNAVAILABLE (Nivel 2). */
  bankMinor: z.number().int().nullable(),
  /** Cuándo ocurrió la última sincronización (para el "conectado hace X" del Nivel 2). */
  syncedAt: z.string(),
});

export const dashboardBox = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: cashBoxType,
  currency: z.string(),
  balanceMinor: z.number().int(),
  bankAccountId: z.string().uuid().nullable(),
  bankName: z.string().nullable(),
  /** Número de cuenta abreviado (últimos 4 dígitos) para la grilla; null si no aplica (Nivel 2). */
  accountNumberMasked: z.string().nullable(),
  /** Cobrador dueño de la caja de ruta; null = caja de oficina/menor (Nivel 2). */
  assignedTo: z.string().uuid().nullable(),
  /** Email del cobrador asignado, para mostrarlo en la grilla; null si no aplica (Nivel 2). */
  assignedToEmail: z.string().nullable(),
  /** Caja de ruta que carga efectivo y no se ha arqueado hoy: requiere cierre urgente (Nivel 2). */
  needsClose: z.boolean(),
  /** Resultado de la última sincronización bancaria; null si nunca se sincronizó (Req 7). */
  lastReconciliation: lastReconciliation.nullable(),
});

export const cashDashboardOutput = z.object({
  /** Σ saldo de todas las cajas activas del tenant (efectivo + bancos + tránsito). */
  totalMinor: z.number().int(),
  /** Efectivo Total en Custodia: Σ cajas CASH activas (Nivel 1). */
  cashTotalMinor: z.number().int(),
  /** Dinero Bancario Total: Σ cajas BANK activas (Nivel 1). */
  bankTotalMinor: z.number().int(),
  /** Liquidez Total disponible: efectivo + bancos (excluye tránsito) (Nivel 1). */
  liquidityTotalMinor: z.number().int(),
  currency: z.string(),
  boxes: z.array(dashboardBox),
  /** Saldo retenido en la caja de tránsito: alerta para coordinador/admin si > 0 (Req 4). */
  unidentifiedMinor: z.number().int(),
});
export type CashDashboardOutput = z.infer<typeof cashDashboardOutput>;

// --- Arqueo y conciliación bancaria (Req 7) ---------------------------------

// Arqueo: el operador reporta el conteo físico; el sistema lo compara con el saldo Σ.
export const cashCountInput = z.object({
  countedMinor: z.number().int().nonnegative(),
  notes: z.string().trim().max(280).optional(),
});

export const cashCountResultView = z.object({
  id: z.string().uuid(),
  cashBoxId: z.string().uuid(),
  systemMinor: z.number().int(),
  countedMinor: z.number().int(),
  differenceMinor: z.number().int(),
  isBalanced: z.boolean(),
  createdAt: z.string(),
});
export type CashCountResultView = z.infer<typeof cashCountResultView>;

export const bankSyncResultView = z.object({
  id: z.string().uuid(),
  cashBoxId: z.string().uuid(),
  status: bankSyncStatus,
  systemMinor: z.number().int(),
  /** Saldo real del banco; null si UNAVAILABLE. */
  bankMinor: z.number().int().nullable(),
  /** bank − system; null si UNAVAILABLE. Distinto de 0 ⇒ descuadre a investigar. */
  differenceMinor: z.number().int().nullable(),
  createdAt: z.string(),
});
export type BankSyncResultView = z.infer<typeof bankSyncResultView>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export const cashBoxesContract = c.router({
  // Cuentas bancarias (solo ADMIN).
  listBankAccounts: {
    method: "GET",
    path: "/bank-accounts",
    headers: tenantHeaders,
    responses: { 200: listBankAccountsOutput },
    summary: "Lista de cuentas bancarias del tenant (ADMIN)",
  },
  createBankAccount: {
    method: "POST",
    path: "/bank-accounts",
    headers: tenantHeaders,
    body: bankAccountInput,
    responses: { 201: bankAccount },
    summary: "Crea una cuenta bancaria (ADMIN)",
  },
  updateBankAccount: {
    method: "PATCH",
    path: "/bank-accounts/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: bankAccountPatch,
    responses: { 200: bankAccount },
    summary: "Edita una cuenta bancaria (ADMIN)",
  },
  deleteBankAccount: {
    method: "DELETE",
    path: "/bank-accounts/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: z.object({ id: z.string().uuid() }) },
    summary: "Elimina una cuenta bancaria sin caja vinculada (ADMIN)",
  },

  // Cajas (CRUD solo ADMIN).
  listCashBoxes: {
    method: "GET",
    path: "/cash/boxes",
    headers: tenantHeaders,
    responses: { 200: listCashBoxesOutput },
    summary: "Lista de cajas del tenant",
  },
  createCashBox: {
    method: "POST",
    path: "/cash/boxes",
    headers: tenantHeaders,
    body: createCashBoxInput,
    responses: { 201: cashBox },
    summary: "Crea una caja (ADMIN)",
  },
  updateCashBox: {
    method: "PATCH",
    path: "/cash/boxes/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: updateCashBoxInput,
    responses: { 200: cashBox },
    summary: "Edita el nombre/estado de una caja (ADMIN)",
  },
  deleteCashBox: {
    method: "DELETE",
    path: "/cash/boxes/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: z.object({ id: z.string().uuid() }) },
    summary: "Elimina una caja sin movimientos (ADMIN)",
  },

  // Movimientos.
  registerWithdrawal: {
    method: "POST",
    path: "/cash/boxes/:id/withdrawals",
    pathParams: idParam,
    headers: tenantHeaders,
    body: registerWithdrawalInput,
    responses: { 201: cashTransactionRow },
    summary: "Registra un retiro/egreso (ADMIN/COORDINATOR)",
  },
  registerCashMovement: {
    method: "POST",
    path: "/cash/boxes/:id/movements",
    pathParams: idParam,
    headers: tenantHeaders,
    body: registerCashMovementInput,
    responses: { 201: cashTransactionRow },
    summary: "Ingreso/egreso manual de caja menor con motivo (ADMIN/COORDINATOR)",
  },
  transfer: {
    method: "POST",
    path: "/cash/transfers",
    headers: tenantHeaders,
    body: transferInput,
    responses: { 201: z.object({ transferGroupId: z.string().uuid() }) },
    summary: "Transfiere entre dos cajas (ADMIN/COORDINATOR)",
  },

  // Vistas.
  listCashTransactions: {
    method: "GET",
    path: "/cash/transactions",
    headers: tenantHeaders,
    query: listCashTransactionsQuery,
    responses: { 200: listCashTransactionsOutput },
    summary: "Historial de movimientos con filtros (fecha/caja/tipo/usuario)",
  },
  getCashDashboard: {
    method: "GET",
    path: "/cash/dashboard",
    headers: tenantHeaders,
    responses: { 200: cashDashboardOutput },
    summary: "Dashboard financiero: saldo total y por caja",
  },

  // Arqueo y conciliación (Req 7).
  performCashCount: {
    method: "POST",
    path: "/cash/boxes/:id/count",
    pathParams: idParam,
    headers: tenantHeaders,
    body: cashCountInput,
    responses: { 201: cashCountResultView },
    summary: "Registra un arqueo de caja y reporta el descuadre (ADMIN/COORDINATOR)",
  },
  syncBankBalance: {
    method: "POST",
    path: "/cash/boxes/:id/sync",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: bankSyncResultView },
    summary: "Sincroniza el saldo real del banco y resalta descuadres (ADMIN)",
  },
});
