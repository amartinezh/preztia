import { describe, it, expect } from "vitest";
import { DomainError } from "../shared/money";
import {
  assertValidSettlementSettings,
  currentOpenPeriod,
  isRetroactive,
  nextPeriodToClose,
  periodContaining,
  type SettlementSettings,
} from "./settlement-period";

const weekly = (anchorDay = 1): SettlementSettings => ({ frequency: "WEEKLY", anchorDay, autoClose: true });
const monthly = (anchorDay = 1): SettlementSettings => ({ frequency: "MONTHLY", anchorDay, autoClose: true });
const biweekly: SettlementSettings = { frequency: "BIWEEKLY", anchorDay: 1, autoClose: true };

describe("periodContaining", () => {
  it("semanal de lunes a domingo (2026-09-24 es jueves)", () => {
    expect(periodContaining(weekly(1), "2026-09-24")).toEqual({ start: "2026-09-21", end: "2026-09-28" });
    expect(periodContaining(weekly(1), "2026-09-21")).toEqual({ start: "2026-09-21", end: "2026-09-28" });
    expect(periodContaining(weekly(1), "2026-09-27")).toEqual({ start: "2026-09-21", end: "2026-09-28" });
  });

  it("semanal con inicio el domingo cruza el fin de año", () => {
    expect(periodContaining(weekly(7), "2026-12-31")).toEqual({ start: "2026-12-27", end: "2027-01-03" });
  });

  it("quincenal: 1–15 y 16–fin de mes (febrero corto)", () => {
    expect(periodContaining(biweekly, "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-16" });
    expect(periodContaining(biweekly, "2026-02-28")).toEqual({ start: "2026-02-16", end: "2026-03-01" });
    expect(periodContaining(biweekly, "2026-12-20")).toEqual({ start: "2026-12-16", end: "2027-01-01" });
  });

  it("mensual desde el día de inicio, también antes de él y en diciembre", () => {
    expect(periodContaining(monthly(1), "2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-03-01" });
    expect(periodContaining(monthly(5), "2026-03-03")).toEqual({ start: "2026-02-05", end: "2026-03-05" });
    expect(periodContaining(monthly(5), "2026-12-20")).toEqual({ start: "2026-12-05", end: "2027-01-05" });
  });
});

describe("assertValidSettlementSettings", () => {
  it("rechaza días de inicio fuera de rango", () => {
    expect(() => assertValidSettlementSettings(weekly(0))).toThrow(DomainError);
    expect(() => assertValidSettlementSettings(weekly(8))).toThrow(DomainError);
    expect(() => assertValidSettlementSettings(monthly(29))).toThrow(DomainError);
    expect(() => assertValidSettlementSettings(monthly(28))).not.toThrow();
  });
});

describe("nextPeriodToClose", () => {
  it("sin cierres previos arranca en el período del primer movimiento del libro", () => {
    expect(nextPeriodToClose(weekly(1), { lastClosedEnd: null, firstActivityDate: "2026-09-02" })).toEqual({
      start: "2026-08-31",
      end: "2026-09-07",
    });
  });

  it("encadena: empieza donde terminó el último cerrado (sin huecos ni solapes)", () => {
    expect(nextPeriodToClose(weekly(1), { lastClosedEnd: "2026-09-07", firstActivityDate: "2026-09-02" })).toEqual({
      start: "2026-09-07",
      end: "2026-09-14",
    });
  });

  it("un cambio de configuración aplica desde el siguiente corte", () => {
    // Se cerró semanal hasta el jueves 17 (p. ej. antes era semanal de jueves); ahora es de lunes.
    expect(nextPeriodToClose(weekly(1), { lastClosedEnd: "2026-09-17", firstActivityDate: null })).toEqual({
      start: "2026-09-17",
      end: "2026-09-21",
    });
  });

  it("sin actividad ni cierres no hay nada que cerrar", () => {
    expect(nextPeriodToClose(weekly(1), { lastClosedEnd: null, firstActivityDate: null })).toBeNull();
  });
});

describe("currentOpenPeriod", () => {
  it("va desde la última liquidación hasta el corte vigente", () => {
    expect(currentOpenPeriod(weekly(1), { lastClosedEnd: "2026-09-21", today: "2026-09-24" })).toEqual({
      start: "2026-09-21",
      end: "2026-09-28",
    });
  });

  it("si hay semanas sin cerrar, muestra todo desde la última liquidación", () => {
    expect(currentOpenPeriod(weekly(1), { lastClosedEnd: "2026-09-07", today: "2026-09-24" })).toEqual({
      start: "2026-09-07",
      end: "2026-09-28",
    });
  });

  it("sin cierres previos, el período que contiene hoy", () => {
    expect(currentOpenPeriod(weekly(1), { lastClosedEnd: null, today: "2026-09-24" })).toEqual({
      start: "2026-09-21",
      end: "2026-09-28",
    });
  });
});

describe("isRetroactive", () => {
  const period = { start: "2026-09-14", end: "2026-09-21" };
  it("cerrado el mismo día de corte no es retroactivo; después sí", () => {
    expect(isRetroactive(period, "2026-09-21")).toBe(false);
    expect(isRetroactive(period, "2026-09-22")).toBe(true);
  });
});
