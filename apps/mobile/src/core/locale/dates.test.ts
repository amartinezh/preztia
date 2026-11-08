import { describe, expect, it } from "vitest";

import { formatDateTime, formatDayMonth, formatLongDate, formatPeriodRange, parseBusinessDate } from "./dates";

/**
 * Especificación (Gherkin):
 *   Dado un período de liquidación con fin exclusivo (el primer día del siguiente)
 *   Cuando dirección lo lee en el histórico
 *   Entonces ve "1 oct – 31 oct" en su idioma, nunca ISO ni el día siguiente al cierre.
 */
describe("fechas legibles", () => {
  const today = new Date(2026, 10, 8);

  it("arma la fecha de negocio como fecha local (sin corrimiento UTC)", () => {
    const date = parseBusinessDate("2026-10-01");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(1);
    expect(parseBusinessDate("hoy")).toBeNull();
    expect(parseBusinessDate("2026-13-45")).toBeNull();
  });

  it("muestra día y mes cortos en el idioma del operador", () => {
    expect(formatDayMonth("2026-11-08", "es")).toBe("8 nov");
    expect(formatDayMonth("2026-11-08", "pt-BR")).toBe("8 nov");
    expect(formatDayMonth("sin-fecha", "es")).toBe("sin-fecha");
  });

  it("el rango de un período resta el día exclusivo del fin", () => {
    expect(formatPeriodRange("2026-10-01", "2026-11-01", "es", today)).toBe("1 oct – 31 oct");
    expect(formatPeriodRange("2026-10-01", "2026-11-01", "pt-BR", today)).toBe("1 out – 31 out");
  });

  it("añade el año cuando el período no es del año en curso o cruza de año", () => {
    expect(formatPeriodRange("2025-10-01", "2025-11-01", "es", today)).toBe("1 oct – 31 oct 2025");
    expect(formatPeriodRange("2025-12-29", "2026-01-05", "es", today)).toBe("29 dic 2025 – 4 ene 2026");
  });

  it("degrada a los textos originales si no son fechas", () => {
    expect(formatPeriodRange("a", "b", "es", today)).toBe("a – b");
    expect(formatDateTime("no-es-instante", "es")).toBe("no-es-instante");
  });

  it("fecha larga e instante de auditoría llevan año", () => {
    expect(formatLongDate("2026-11-08", "es")).toBe("8 de noviembre de 2026");
    // El año solo se muestra cuando el instante no es del año en curso (regla del formateador compartido).
    expect(formatDateTime("2024-11-08T15:04:00.000Z", "es")).toContain("2024");
    expect(formatDateTime("2026-11-08T15:04:00.000Z", "es")).toMatch(/8 nov, \d{2}:\d{2}/);
  });
});
