import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  daysBetweenIso,
  formatDate,
  formatDateTime,
  formatShortDate,
  isCompleteIsoDateText,
  isValidIsoDate,
  maskIsoDateInput,
  nextWeekdayIso,
  todayIso,
} from "./date";

/**
 * Especificación (Gherkin):
 *   Dado que una fecha de negocio viaja como `YYYY-MM-DD`
 *   Cuando la app la muestra
 *   Entonces el mes aparece con nombre ("8 nov 2026"), nunca como "11-08",
 *   Y la fecha no se corre un día por la zona horaria del dispositivo.
 */
describe("formatDate / formatShortDate", () => {
  it("muestra día, mes corto y año en español", () => {
    expect(formatDate("2026-11-08", "es-CO")).toBe("8 nov 2026");
    expect(formatDate("2026-01-01", "es")).toBe("1 ene 2026");
  });

  it("acepta pt-BR y cae a español para cualquier otro locale", () => {
    expect(formatDate("2026-11-08", "pt-BR")).toBe("8 nov 2026");
    expect(formatDate("2026-09-08", "pt-BR")).toBe("8 set 2026");
    expect(formatDate("2026-09-08", "en-US")).toBe("8 sep 2026");
  });

  it("la forma corta omite el año y nunca es numérica ambigua", () => {
    expect(formatShortDate("2026-11-08", "es")).toBe("8 nov");
    expect(formatShortDate("2026-11-08")).not.toContain("11-08");
  });

  it("tolera un datetime ISO quedándose con la parte de fecha y devuelve lo ilegible tal cual", () => {
    expect(formatDate("2026-11-08T00:00:00.000Z")).toBe("8 nov 2026");
    expect(formatDate("no-es-fecha")).toBe("no-es-fecha");
    expect(formatShortDate("")).toBe("");
  });

  it("no corre la fecha un día por la zona horaria (se lee como fecha local)", () => {
    // Si se interpretara como UTC, en América "2026-11-08" podría mostrarse como 7 nov.
    expect(formatDate("2026-11-08")).toBe("8 nov 2026");
  });
});

describe("formatDateTime", () => {
  const now = new Date(2026, 10, 8, 12, 0, 0);

  it("muestra día, mes y hora 24h sin año cuando es el año en curso", () => {
    // Instante construido en hora local para no depender de la zona del runner.
    const iso = new Date(2026, 10, 8, 14, 5).toISOString();
    expect(formatDateTime(iso, "es", undefined, now)).toBe("8 nov, 14:05");
  });

  it("añade el año cuando no es el actual", () => {
    const iso = new Date(2025, 2, 3, 9, 7).toISOString();
    expect(formatDateTime(iso, "es", undefined, now)).toBe("3 mar 2025, 09:07");
  });

  it("respeta la zona horaria pedida (la de la empresa)", () => {
    // 2026-11-08T03:30Z son las 22:30 del 7 nov en Bogotá (UTC-5) y las 00:30 del 8 nov en São Paulo (UTC-3).
    expect(formatDateTime("2026-11-08T03:30:00.000Z", "es", "America/Bogota", now)).toBe("7 nov, 22:30");
    expect(formatDateTime("2026-11-08T03:30:00.000Z", "pt-BR", "America/Sao_Paulo", now)).toBe("8 nov, 00:30");
  });

  it("con zona desconocida degrada a la hora local y lo ilegible vuelve tal cual", () => {
    const iso = new Date(2026, 10, 8, 14, 5).toISOString();
    expect(formatDateTime(iso, "es", "Zona/Inexistente", now)).toBe("8 nov, 14:05");
    expect(formatDateTime("basura", "es")).toBe("basura");
  });
});

/**
 * Especificación (Gherkin):
 *   Dado que una persona teclea una fecha en el móvil
 *   Cuando escribe solo dígitos
 *   Entonces la máscara inserta los guiones de AAAA-MM-DD
 *   Y solo una fecha que existe en el calendario se considera válida.
 */
describe("maskIsoDateInput / isValidIsoDate", () => {
  it("inserta los guiones a medida que se teclea y limita a 8 dígitos", () => {
    expect(maskIsoDateInput("2")).toBe("2");
    expect(maskIsoDateInput("2026")).toBe("2026");
    expect(maskIsoDateInput("20261")).toBe("2026-1");
    expect(maskIsoDateInput("202611")).toBe("2026-11");
    expect(maskIsoDateInput("2026110")).toBe("2026-11-0");
    expect(maskIsoDateInput("20261108")).toBe("2026-11-08");
    expect(maskIsoDateInput("202611089999")).toBe("2026-11-08");
  });

  it("es idempotente sobre texto ya enmascarado e ignora lo que no es dígito", () => {
    expect(maskIsoDateInput("2026-11-08")).toBe("2026-11-08");
    expect(maskIsoDateInput("2026/11/08")).toBe("2026-11-08");
    expect(maskIsoDateInput("")).toBe("");
  });

  it("valida solo fechas reales del calendario", () => {
    expect(isValidIsoDate("2026-11-08")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-00-10")).toBe(false);
    expect(isValidIsoDate("2026-11-8")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });

  it("distingue una fecha completa de una a medio teclear", () => {
    expect(isCompleteIsoDateText("2026-11-08")).toBe(true);
    expect(isCompleteIsoDateText("2026-11")).toBe(false);
  });
});

describe("todayIso / addDaysIso / nextWeekdayIso / daysBetweenIso", () => {
  it("todayIso usa la fecha local del reloj inyectado", () => {
    expect(todayIso(new Date(2026, 10, 8, 23, 59))).toBe("2026-11-08");
    expect(todayIso(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("suma y resta días cruzando fin de mes y de año", () => {
    expect(addDaysIso("2026-11-08", 1)).toBe("2026-11-09");
    expect(addDaysIso("2026-11-08", -1)).toBe("2026-11-07");
    expect(addDaysIso("2026-11-30", 2)).toBe("2026-12-02");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("el próximo lunes es estrictamente posterior (si hoy es lunes, el de la semana siguiente)", () => {
    // 2026-11-08 es domingo; 2026-11-09 es lunes.
    expect(nextWeekdayIso("2026-11-08", 1)).toBe("2026-11-09");
    expect(nextWeekdayIso("2026-11-09", 1)).toBe("2026-11-16");
    expect(nextWeekdayIso("2026-11-10", 1)).toBe("2026-11-16");
  });

  it("cuenta días calendario entre dos fechas", () => {
    expect(daysBetweenIso("2026-11-08", "2026-11-08")).toBe(0);
    expect(daysBetweenIso("2026-11-08", "2026-11-10")).toBe(2);
    expect(daysBetweenIso("2026-11-10", "2026-11-08")).toBe(-2);
    expect(daysBetweenIso("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("deja intacto un texto que no es fecha", () => {
    expect(addDaysIso("x", 3)).toBe("x");
    expect(nextWeekdayIso("x", 1)).toBe("x");
    expect(daysBetweenIso("x", "2026-11-08")).toBe(0);
  });
});
