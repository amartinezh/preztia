// Dominio puro de la LIQUIDACIÓN: arma la "fotografía" de un período a partir del libro de cajas
// y de la cartera, y la recorta al alcance de quien la mira. Sin I/O: la infraestructura le pasa
// los saldos iniciales y los movimientos ya agregados.
//
// Dos lentes que no se mezclan:
// - Tesorería (la plata): saldo inicial + entradas − salidas = saldo final, por caja, zona y total.
// - Resultado (el negocio): interés ganado, capital recuperado, gastos, condonaciones, utilidad.
//
// Invariantes (probadas):
// - I1: por caja y en total, opening + in − out = closing.
// - I3: Σ zonas = Σ cajas = total (los asientos sin zona van a la línea "sin zona").
// - utilidad = interés ganado − gastos − condonado (lo recuperado por nómina no es pérdida).

import { isWithinScope } from "../iam/zone-path";
import { type CashBoxType, type CashTxDirection, type CashTxKind } from "./cash-box";
import { type DebtClosureType } from "./remittance";

/** Concepto de tesorería de un movimiento (fila de la tabla de liquidación). */
export type SettlementConcept =
  | "COLLECTED"
  | "UNIDENTIFIED"
  | "DISBURSED"
  | "EXPENSES"
  | "WITHDRAWALS"
  | "TRANSFERS_IN"
  | "TRANSFERS_OUT"
  | "ADJUSTMENTS_IN"
  | "ADJUSTMENTS_OUT"
  | "DEBT_PAYROLL"
  | "DEBT_WRITE_OFF"
  | "OTHER_IN"
  | "OTHER_OUT";

export const SETTLEMENT_CONCEPTS: readonly SettlementConcept[] = [
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
];

export type ConceptAmounts = Readonly<Record<SettlementConcept, number>>;

/** Movimientos del período agregados por caja, zona, cobrador y naturaleza. */
export interface SettlementFlow {
  readonly cashBoxId: string;
  readonly zoneId: string | null;
  readonly collectorId: string | null;
  readonly kind: CashTxKind;
  readonly direction: CashTxDirection;
  readonly debtClosureType: DebtClosureType | null;
  readonly amountMinor: number;
}

export interface SettlementBoxInput {
  readonly cashBoxId: string;
  readonly name: string;
  readonly type: CashBoxType;
  readonly zoneId: string | null;
  readonly zonePath: string | null;
  /** Cobrador dueño si es caja de ruta. */
  readonly collectorId: string | null;
  readonly openingMinor: number;
}

export interface SettlementZoneRef {
  readonly zoneId: string;
  readonly name: string;
  readonly path: string;
}

export interface SettlementCollectorRef {
  readonly collectorId: string;
  readonly email: string | null;
  readonly zonePath: string | null;
}

/** Actividad de campo del cobrador en el período (la cuenta la infraestructura). */
export interface CollectorActivity {
  readonly collectorId: string;
  readonly stopsDispatched: number;
  readonly stopsResolved: number;
  readonly stopsPaid: number;
  /** Σ minutos entre despacho y liquidación de las paradas resueltas. */
  readonly resolveMinutesTotal: number;
  readonly depositsIssued: number;
  readonly depositsVerified: number;
  /** Σ minutos entre la orden y el reporte de las consignaciones reportadas. */
  readonly depositReportMinutesTotal: number;
  readonly depositsReported: number;
  readonly remittancesSubmitted: number;
  readonly remittancesLate: number;
}

/** Indicadores de desempeño del cobrador (control estricto y estadístico). */
export interface CollectorPerformance {
  readonly stopsDispatched: number;
  readonly stopsResolved: number;
  /** Visitas con pago sobre visitas liquidadas, base mil; null sin visitas. */
  readonly effectiveVisitRatePerMille: number | null;
  readonly avgResolveMinutes: number | null;
  readonly depositsIssued: number;
  readonly depositsVerified: number;
  readonly avgDepositReportMinutes: number | null;
  readonly remittancesSubmitted: number;
  readonly remittancesLate: number;
}

/** Métricas de cartera del período por zona (las calcula la infraestructura sobre la cartera). */
export interface PortfolioByZone {
  readonly zoneId: string;
  readonly interestEarnedMinor: number;
  readonly principalRecoveredMinor: number;
  readonly newCreditsCount: number;
  readonly newCreditsPrincipalMinor: number;
  /** Σ de las cuotas que vencían en el período. */
  readonly dueInPeriodMinor: number;
  /** Σ abonado a la cartera en el período (cualquier cuota). */
  readonly collectedOnPortfolioMinor: number;
  /** Pendiente de cuotas vencidas al corte (estado de la cartera al cerrar). */
  readonly overdueAtCutMinor: number;
}

export interface SettlementResult {
  readonly interestEarnedMinor: number;
  readonly principalRecoveredMinor: number;
  readonly expensesMinor: number;
  readonly writeOffMinor: number;
  readonly payrollRecoveredMinor: number;
  readonly utilityMinor: number;
  readonly newCreditsCount: number;
  readonly newCreditsPrincipalMinor: number;
  readonly dueInPeriodMinor: number;
  readonly collectedOnPortfolioMinor: number;
  /** Recaudo sobre lo que vencía, en base mil (1000 = 100%); null si no vencía nada. */
  readonly collectionRatePerMille: number | null;
  readonly overdueAtCutMinor: number;
}

export interface SettlementBoxLine {
  readonly cashBoxId: string;
  readonly name: string;
  readonly type: CashBoxType;
  readonly zoneId: string | null;
  readonly zonePath: string | null;
  readonly collectorId: string | null;
  readonly openingMinor: number;
  readonly inMinor: number;
  readonly outMinor: number;
  readonly closingMinor: number;
  readonly concepts: ConceptAmounts;
}

export interface SettlementZoneLine {
  /** null = asientos sin zona (cajas del tenant). */
  readonly zoneId: string | null;
  readonly name: string | null;
  readonly path: string | null;
  readonly inMinor: number;
  readonly outMinor: number;
  readonly concepts: ConceptAmounts;
  readonly result: SettlementResult;
}

export interface SettlementCollectorLine {
  readonly collectorId: string;
  readonly email: string | null;
  readonly zonePath: string | null;
  readonly collectedMinor: number;
  readonly expensesMinor: number;
  readonly transferredOutMinor: number;
  readonly payrollMinor: number;
  readonly writeOffMinor: number;
  /** Efectivo en su caja de ruta al corte (lo no entregado = deuda). */
  readonly closingCashMinor: number;
  readonly performance: CollectorPerformance;
}

export interface SettlementSnapshot {
  readonly totals: {
    readonly openingMinor: number;
    readonly inMinor: number;
    readonly outMinor: number;
    readonly closingMinor: number;
    readonly concepts: ConceptAmounts;
  };
  readonly result: SettlementResult;
  readonly boxes: readonly SettlementBoxLine[];
  readonly zones: readonly SettlementZoneLine[];
  readonly collectors: readonly SettlementCollectorLine[];
}

const PER_MILLE = 1000;

/** Concepto de tesorería de un asiento. */
export function conceptOf(kind: CashTxKind, direction: CashTxDirection, debtType: DebtClosureType | null): SettlementConcept {
  const inbound = direction === "IN";
  switch (kind) {
    case "PAYMENT_IN":
      return inbound ? "COLLECTED" : "OTHER_OUT";
    case "UNIDENTIFIED":
      return inbound ? "UNIDENTIFIED" : "OTHER_OUT";
    case "DISBURSEMENT":
      return inbound ? "OTHER_IN" : "DISBURSED";
    case "EXPENSE":
      return inbound ? "OTHER_IN" : "EXPENSES";
    case "WITHDRAWAL":
      return inbound ? "OTHER_IN" : "WITHDRAWALS";
    case "TRANSFER":
      return inbound ? "TRANSFERS_IN" : "TRANSFERS_OUT";
    case "ADJUSTMENT":
      return inbound ? "ADJUSTMENTS_IN" : "ADJUSTMENTS_OUT";
    case "DEBT_CLOSURE":
      if (inbound) return "OTHER_IN";
      return debtType === "WRITE_OFF" ? "DEBT_WRITE_OFF" : "DEBT_PAYROLL";
  }
}

/** Arma la fotografía del período. */
export function buildSettlement(input: {
  boxes: readonly SettlementBoxInput[];
  flows: readonly SettlementFlow[];
  zones: readonly SettlementZoneRef[];
  collectors: readonly SettlementCollectorRef[];
  portfolio: readonly PortfolioByZone[];
  activity?: readonly CollectorActivity[];
}): SettlementSnapshot {
  const boxes = input.boxes.map((box) => boxLine(box, input.flows.filter((f) => f.cashBoxId === box.cashBoxId)));
  const zones = zoneLines(input);
  const collectors = input.collectors.map((c) =>
    collectorLine(c, input.flows, input.boxes, input.activity?.find((a) => a.collectorId === c.collectorId)),
  );
  return {
    totals: sumTreasury(boxes),
    result: mergeResults(zones.map((z) => z.result)),
    boxes,
    zones,
    collectors,
  };
}

/**
 * Recorta la fotografía al subárbol de zonas del coordinador (null = ADMIN, sin recorte). Los
 * totales se recalculan con lo visible: su tesorería son sus cajas; su resultado, sus zonas.
 */
export function scopeSettlement(snapshot: SettlementSnapshot, scopes: readonly string[] | null): SettlementSnapshot {
  if (scopes === null) return snapshot;
  const visible = (path: string | null) => path !== null && isWithinScope(path, scopes);
  const boxes = snapshot.boxes.filter((b) => visible(b.zonePath));
  const zones = snapshot.zones.filter((z) => visible(z.path));
  return {
    totals: sumTreasury(boxes),
    result: mergeResults(zones.map((z) => z.result)),
    boxes,
    zones,
    collectors: snapshot.collectors.filter((c) => visible(c.zonePath)),
  };
}

function emptyConcepts(): Record<SettlementConcept, number> {
  return Object.fromEntries(SETTLEMENT_CONCEPTS.map((c) => [c, 0])) as Record<SettlementConcept, number>;
}

function conceptsOf(flows: readonly SettlementFlow[]): { concepts: ConceptAmounts; inMinor: number; outMinor: number } {
  const concepts = emptyConcepts();
  let inMinor = 0;
  let outMinor = 0;
  for (const f of flows) {
    concepts[conceptOf(f.kind, f.direction, f.debtClosureType)] += f.amountMinor;
    if (f.direction === "IN") inMinor += f.amountMinor;
    else outMinor += f.amountMinor;
  }
  return { concepts, inMinor, outMinor };
}

function boxLine(box: SettlementBoxInput, flows: readonly SettlementFlow[]): SettlementBoxLine {
  const { concepts, inMinor, outMinor } = conceptsOf(flows);
  return {
    cashBoxId: box.cashBoxId,
    name: box.name,
    type: box.type,
    zoneId: box.zoneId,
    zonePath: box.zonePath,
    collectorId: box.collectorId,
    openingMinor: box.openingMinor,
    inMinor,
    outMinor,
    closingMinor: box.openingMinor + inMinor - outMinor,
    concepts,
  };
}

function zoneLines(input: {
  flows: readonly SettlementFlow[];
  zones: readonly SettlementZoneRef[];
  portfolio: readonly PortfolioByZone[];
}): SettlementZoneLine[] {
  const refs = new Map(input.zones.map((z) => [z.zoneId, z]));
  const zoneIds = new Set<string | null>([
    ...input.flows.map((f) => f.zoneId),
    ...input.portfolio.map((p) => p.zoneId),
  ]);
  return [...zoneIds].map((zoneId) => {
    const { concepts, inMinor, outMinor } = conceptsOf(input.flows.filter((f) => f.zoneId === zoneId));
    const ref = zoneId ? refs.get(zoneId) : undefined;
    const portfolio = input.portfolio.find((p) => p.zoneId === zoneId);
    return {
      zoneId,
      name: ref?.name ?? null,
      path: ref?.path ?? null,
      inMinor,
      outMinor,
      concepts,
      result: resultOf(concepts, portfolio),
    };
  });
}

function resultOf(concepts: ConceptAmounts, p: PortfolioByZone | undefined): SettlementResult {
  const interest = p?.interestEarnedMinor ?? 0;
  const due = p?.dueInPeriodMinor ?? 0;
  const collected = p?.collectedOnPortfolioMinor ?? 0;
  return {
    interestEarnedMinor: interest,
    principalRecoveredMinor: p?.principalRecoveredMinor ?? 0,
    expensesMinor: concepts.EXPENSES,
    writeOffMinor: concepts.DEBT_WRITE_OFF,
    payrollRecoveredMinor: concepts.DEBT_PAYROLL,
    utilityMinor: interest - concepts.EXPENSES - concepts.DEBT_WRITE_OFF,
    newCreditsCount: p?.newCreditsCount ?? 0,
    newCreditsPrincipalMinor: p?.newCreditsPrincipalMinor ?? 0,
    dueInPeriodMinor: due,
    collectedOnPortfolioMinor: collected,
    collectionRatePerMille: due > 0 ? Math.floor((collected * PER_MILLE) / due) : null,
    overdueAtCutMinor: p?.overdueAtCutMinor ?? 0,
  };
}

function mergeResults(results: readonly SettlementResult[]): SettlementResult {
  const sum = (pick: (r: SettlementResult) => number) => results.reduce((acc, r) => acc + pick(r), 0);
  const due = sum((r) => r.dueInPeriodMinor);
  const collected = sum((r) => r.collectedOnPortfolioMinor);
  const interest = sum((r) => r.interestEarnedMinor);
  const expenses = sum((r) => r.expensesMinor);
  const writeOff = sum((r) => r.writeOffMinor);
  return {
    interestEarnedMinor: interest,
    principalRecoveredMinor: sum((r) => r.principalRecoveredMinor),
    expensesMinor: expenses,
    writeOffMinor: writeOff,
    payrollRecoveredMinor: sum((r) => r.payrollRecoveredMinor),
    utilityMinor: interest - expenses - writeOff,
    newCreditsCount: sum((r) => r.newCreditsCount),
    newCreditsPrincipalMinor: sum((r) => r.newCreditsPrincipalMinor),
    dueInPeriodMinor: due,
    collectedOnPortfolioMinor: collected,
    collectionRatePerMille: due > 0 ? Math.floor((collected * PER_MILLE) / due) : null,
    overdueAtCutMinor: sum((r) => r.overdueAtCutMinor),
  };
}

function sumTreasury(boxes: readonly SettlementBoxLine[]): SettlementSnapshot["totals"] {
  const concepts = emptyConcepts();
  for (const b of boxes) for (const c of SETTLEMENT_CONCEPTS) concepts[c] += b.concepts[c];
  const sum = (pick: (b: SettlementBoxLine) => number) => boxes.reduce((acc, b) => acc + pick(b), 0);
  return {
    openingMinor: sum((b) => b.openingMinor),
    inMinor: sum((b) => b.inMinor),
    outMinor: sum((b) => b.outMinor),
    closingMinor: sum((b) => b.closingMinor),
    concepts,
  };
}

/** Indicadores a partir de la actividad (promedios enteros en minutos; tasas en base mil). */
export function collectorPerformance(a: CollectorActivity | undefined): CollectorPerformance {
  const avg = (total: number, n: number) => (n > 0 ? Math.round(total / n) : null);
  return {
    stopsDispatched: a?.stopsDispatched ?? 0,
    stopsResolved: a?.stopsResolved ?? 0,
    effectiveVisitRatePerMille:
      a && a.stopsResolved > 0 ? Math.floor((a.stopsPaid * PER_MILLE) / a.stopsResolved) : null,
    avgResolveMinutes: avg(a?.resolveMinutesTotal ?? 0, a?.stopsResolved ?? 0),
    depositsIssued: a?.depositsIssued ?? 0,
    depositsVerified: a?.depositsVerified ?? 0,
    avgDepositReportMinutes: avg(a?.depositReportMinutesTotal ?? 0, a?.depositsReported ?? 0),
    remittancesSubmitted: a?.remittancesSubmitted ?? 0,
    remittancesLate: a?.remittancesLate ?? 0,
  };
}

function collectorLine(
  ref: SettlementCollectorRef,
  flows: readonly SettlementFlow[],
  boxes: readonly SettlementBoxInput[],
  activity: CollectorActivity | undefined,
): SettlementCollectorLine {
  const own = flows.filter((f) => f.collectorId === ref.collectorId);
  const { concepts } = conceptsOf(own);
  // El efectivo al corte es el saldo final de sus cajas de ruta.
  const routeBoxes = boxes.filter((b) => b.collectorId === ref.collectorId);
  const closingCashMinor = routeBoxes.reduce((acc, b) => {
    const { inMinor, outMinor } = conceptsOf(flows.filter((f) => f.cashBoxId === b.cashBoxId));
    return acc + b.openingMinor + inMinor - outMinor;
  }, 0);
  return {
    collectorId: ref.collectorId,
    email: ref.email,
    zonePath: ref.zonePath,
    collectedMinor: concepts.COLLECTED,
    expensesMinor: concepts.EXPENSES,
    transferredOutMinor: concepts.TRANSFERS_OUT,
    payrollMinor: concepts.DEBT_PAYROLL,
    writeOffMinor: concepts.DEBT_WRITE_OFF,
    closingCashMinor,
    performance: collectorPerformance(activity),
  };
}
