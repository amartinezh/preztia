import { initContract } from "@ts-rest/core";
import { z } from "zod";

import { paginationQuery } from "./payments";

const c = initContract();

// Contrato de la LIQUIDACIÓN POR PERÍODOS. El período abierto se calcula en vivo desde el libro de
// cajas ("todo lo que pasó desde la última liquidación"); al cerrar se sella una FOTOGRAFÍA que ya
// no cambia. Dos lentes: tesorería (la plata) y resultado (el negocio). ADMIN ve todo; el
// COORDINATOR, recortado a su subárbol de zonas; el COLLECTOR no ve liquidaciones.
// Dinero en unidades menores. Ver docs/PLAN_CONTROL_CAMPO_Y_LIQUIDACION.md (Fase 6).

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const money = z.number().int();

export const settlementConcept = z.enum([
  "COLLECTED",
  "UNIDENTIFIED",
  "DISBURSED",
  "EXPENSES",
  "WITHDRAWALS",
  "TRANSFERS_IN",
  "TRANSFERS_OUT",
  "ADJUSTMENTS_IN",
  "ADJUSTMENTS_OUT",
  "DEBT_PAYROLL",
  "DEBT_WRITE_OFF",
  "OTHER_IN",
  "OTHER_OUT",
]);
export type SettlementConcept = z.infer<typeof settlementConcept>;
const conceptAmounts = z.record(settlementConcept, money);

export const settlementResult = z.object({
  interestEarnedMinor: money,
  principalRecoveredMinor: money,
  expensesMinor: money,
  writeOffMinor: money,
  payrollRecoveredMinor: money,
  /** interés ganado − gastos − condonado. */
  utilityMinor: money,
  newCreditsCount: z.number().int(),
  newCreditsPrincipalMinor: money,
  dueInPeriodMinor: money,
  collectedOnPortfolioMinor: money,
  /** Recaudo sobre lo que vencía, en base mil (1000 = 100%); null si no vencía nada. */
  collectionRatePerMille: z.number().int().nullable(),
  overdueAtCutMinor: money,
});
export type SettlementResult = z.infer<typeof settlementResult>;

const treasuryTotals = z.object({
  openingMinor: money,
  inMinor: money,
  outMinor: money,
  closingMinor: money,
  concepts: conceptAmounts,
});

export const settlementSnapshot = z.object({
  totals: treasuryTotals,
  result: settlementResult,
  boxes: z.array(
    z.object({
      cashBoxId: z.string().uuid(),
      name: z.string(),
      type: z.enum(["CASH", "BANK", "TRANSIT"]),
      zoneId: z.string().uuid().nullable(),
      zonePath: z.string().nullable(),
      collectorId: z.string().uuid().nullable(),
      openingMinor: money,
      inMinor: money,
      outMinor: money,
      closingMinor: money,
      concepts: conceptAmounts,
    }),
  ),
  zones: z.array(
    z.object({
      zoneId: z.string().uuid().nullable(),
      name: z.string().nullable(),
      path: z.string().nullable(),
      inMinor: money,
      outMinor: money,
      concepts: conceptAmounts,
      result: settlementResult,
    }),
  ),
  collectors: z.array(
    z.object({
      collectorId: z.string().uuid(),
      email: z.string().nullable(),
      zonePath: z.string().nullable(),
      collectedMinor: money,
      expensesMinor: money,
      transferredOutMinor: money,
      payrollMinor: money,
      writeOffMinor: money,
      closingCashMinor: money,
      /** Desempeño de campo del período; ausente en fotos anteriores a la Fase 7. */
      performance: z
        .object({
          stopsDispatched: z.number().int(),
          stopsResolved: z.number().int(),
          effectiveVisitRatePerMille: z.number().int().nullable(),
          avgResolveMinutes: z.number().int().nullable(),
          depositsIssued: z.number().int(),
          depositsVerified: z.number().int(),
          avgDepositReportMinutes: z.number().int().nullable(),
          remittancesSubmitted: z.number().int(),
          remittancesLate: z.number().int(),
        })
        .optional(),
    }),
  ),
});
export type SettlementSnapshot = z.infer<typeof settlementSnapshot>;

const periodFields = {
  periodStart: z.string(),
  /** Exclusivo: el primer día del período siguiente. */
  periodEnd: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]),
  currency: z.string(),
};

/** Período abierto (en vivo) o cerrado (fotografía sellada). */
export const settlementView = z.object({
  /** null en el período abierto (todavía no es una foto). */
  id: z.string().uuid().nullable(),
  ...periodFields,
  isOpen: z.boolean(),
  retroactive: z.boolean(),
  closedAt: z.string().nullable(),
  /** null = cierre automático del sistema (o período abierto). */
  closedBy: z.string().uuid().nullable(),
  snapshot: settlementSnapshot,
});
export type SettlementView = z.infer<typeof settlementView>;

export const currentSettlementOutput = settlementView.extend({
  /** Períodos ya terminados que faltan por cerrar (antes de este). */
  pendingClosures: z.number().int(),
});
export type CurrentSettlementOutput = z.infer<typeof currentSettlementOutput>;

/** Fila del histórico (sin la foto completa): base de las estadísticas por período. */
export const settlementSummary = z.object({
  id: z.string().uuid(),
  ...periodFields,
  retroactive: z.boolean(),
  closedAt: z.string(),
  closedBy: z.string().uuid().nullable(),
  totals: treasuryTotals,
  result: settlementResult,
});
export type SettlementSummary = z.infer<typeof settlementSummary>;

export const settlementsPage = z.object({
  items: z.array(settlementSummary),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const settlementsContract = c.router({
  getCurrentSettlement: {
    method: "GET",
    path: "/settlements/current",
    headers: tenantHeaders,
    responses: { 200: currentSettlementOutput },
    summary: "Liquidación en curso: todo lo que pasó desde la última liquidación, en vivo",
  },
  listSettlements: {
    method: "GET",
    path: "/settlements",
    headers: tenantHeaders,
    query: paginationQuery,
    responses: { 200: settlementsPage },
    summary: "Histórico de liquidaciones cerradas (más recientes primero), con totales y resultado",
  },
  getSettlement: {
    method: "GET",
    path: "/settlements/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    responses: { 200: settlementView },
    summary: "Fotografía de una liquidación cerrada",
  },
  closeSettlement: {
    method: "POST",
    path: "/settlements/close",
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 201: settlementView },
    summary: "Cierra el siguiente período terminado (repetir reconstruye la historia) — solo ADMIN",
  },
});
