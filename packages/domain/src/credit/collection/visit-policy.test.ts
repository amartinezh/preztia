import { describe, it, expect } from "vitest";
import { ConflictError, DomainError } from "../../shared/money";
import {
  assertCanMarkVisited,
  isVisitedInCurrentCycle,
  needsVisit,
} from "./visit-policy";

describe("needsVisit", () => {
  it("no agenda visita por debajo del umbral", () => {
    expect(needsVisit({ overdueCount: 2, threshold: 3, lastVisitOverdueCount: null })).toBe(false);
  });

  it("agenda la primera visita al alcanzar el umbral", () => {
    expect(needsVisit({ overdueCount: 3, threshold: 3, lastVisitOverdueCount: null })).toBe(true);
  });

  it("no reagenda mientras la mora no crece otro umbral tras la visita", () => {
    // Visitado con 3; a las 4 y 5 sigue cubierto.
    expect(needsVisit({ overdueCount: 3, threshold: 3, lastVisitOverdueCount: 3 })).toBe(false);
    expect(needsVisit({ overdueCount: 5, threshold: 3, lastVisitOverdueCount: 3 })).toBe(false);
  });

  it("reagenda cuando la mora crece otro umbral completo (3 → 6 → 9)", () => {
    expect(needsVisit({ overdueCount: 6, threshold: 3, lastVisitOverdueCount: 3 })).toBe(true);
    expect(needsVisit({ overdueCount: 9, threshold: 3, lastVisitOverdueCount: 6 })).toBe(true);
  });

  it("con umbral 1 agenda en cada cuota vencida nueva", () => {
    expect(needsVisit({ overdueCount: 1, threshold: 1, lastVisitOverdueCount: null })).toBe(true);
    expect(needsVisit({ overdueCount: 1, threshold: 1, lastVisitOverdueCount: 1 })).toBe(false);
    expect(needsVisit({ overdueCount: 2, threshold: 1, lastVisitOverdueCount: 1 })).toBe(true);
  });
});

describe("isVisitedInCurrentCycle", () => {
  it("es falso si nunca se ha visitado", () => {
    expect(isVisitedInCurrentCycle({ overdueCount: 3, threshold: 3, lastVisitOverdueCount: null })).toBe(false);
  });

  it("es cierto cuando hay visita y aún está cubierto", () => {
    expect(isVisitedInCurrentCycle({ overdueCount: 4, threshold: 3, lastVisitOverdueCount: 3 })).toBe(true);
  });

  it("es falso cuando vuelve a necesitar visita (cruzó el siguiente umbral)", () => {
    expect(isVisitedInCurrentCycle({ overdueCount: 6, threshold: 3, lastVisitOverdueCount: 3 })).toBe(false);
  });
});

describe("assertCanMarkVisited", () => {
  it("permite marcar cuando toca visita y hay observación nueva", () => {
    expect(() =>
      assertCanMarkVisited({
        overdueCount: 3,
        threshold: 3,
        lastVisitOverdueCount: null,
        hasFreshObservation: true,
      }),
    ).not.toThrow();
  });

  it("rechaza (400) por debajo del umbral", () => {
    expect(() =>
      assertCanMarkVisited({
        overdueCount: 2,
        threshold: 3,
        lastVisitOverdueCount: null,
        hasFreshObservation: true,
      }),
    ).toThrow(DomainError);
  });

  it("rechaza (409) si ya fue visitado en el ciclo vigente", () => {
    expect(() =>
      assertCanMarkVisited({
        overdueCount: 4,
        threshold: 3,
        lastVisitOverdueCount: 3,
        hasFreshObservation: true,
      }),
    ).toThrow(ConflictError);
  });

  it("rechaza (400) si no hay observación nueva desde la última visita", () => {
    expect(() =>
      assertCanMarkVisited({
        overdueCount: 6,
        threshold: 3,
        lastVisitOverdueCount: 3,
        hasFreshObservation: false,
      }),
    ).toThrow(DomainError);
  });
});
