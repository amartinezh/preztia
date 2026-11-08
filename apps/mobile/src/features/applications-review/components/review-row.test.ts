import { describe, expect, it } from "vitest";
import { relativeTime, zoneLeafName } from "./review-row";

// Reloj fijo en hora local: 8 nov 2026, 12:00.
const NOW = new Date(2026, 10, 8, 12, 0, 0);
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const hoursAgo = (n: number) => minutesAgo(n * 60);

/**
 * Especificación (Gherkin):
 *   Dado que el revisor ve la bandeja de solicitudes
 *   Cuando una solicitud lleva cierto tiempo esperando
 *   Entonces la fila dice cuánto ("hace 2 h", "ayer", "hace 3 días") para priorizar
 *   Y lo muy antiguo muestra la fecha en vez de un conteo que no ayuda.
 */
describe("relativeTime", () => {
  it("menos de un minuto es 'ahora' (también un instante futuro)", () => {
    expect(relativeTime(minutesAgo(0), NOW)).toEqual({ kind: "now" });
    expect(relativeTime(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toEqual({ kind: "now" });
  });

  it("cuenta minutos hasta la hora y horas hasta el día", () => {
    expect(relativeTime(minutesAgo(5), NOW)).toEqual({ kind: "minutes", n: 5 });
    expect(relativeTime(minutesAgo(59), NOW)).toEqual({ kind: "minutes", n: 59 });
    expect(relativeTime(hoursAgo(2), NOW)).toEqual({ kind: "hours", n: 2 });
    expect(relativeTime(hoursAgo(23), NOW)).toEqual({ kind: "hours", n: 23 });
  });

  it("de 24 h en adelante usa días calendario: ayer, luego 'hace N días'", () => {
    expect(relativeTime(hoursAgo(24), NOW)).toEqual({ kind: "yesterday" });
    expect(relativeTime(new Date(2026, 10, 7, 1, 0).toISOString(), NOW)).toEqual({ kind: "yesterday" });
    expect(relativeTime(new Date(2026, 10, 5, 23, 0).toISOString(), NOW)).toEqual({ kind: "days", n: 3 });
    expect(relativeTime(new Date(2026, 9, 9, 12, 0).toISOString(), NOW)).toEqual({ kind: "days", n: 30 });
  });

  it("más de 30 días devuelve la fecha; un instante ilegible se devuelve tal cual", () => {
    const old = new Date(2026, 9, 8, 12, 0);
    expect(relativeTime(old.toISOString(), NOW)).toEqual({ kind: "date", at: old });
    expect(relativeTime("no-es-fecha", NOW)).toEqual({ kind: "unreadable", text: "no-es-fecha" });
  });
});

describe("zoneLeafName", () => {
  it("toma el último segmento del path y lo capitaliza", () => {
    expect(zoneLeafName("bogota.centro")).toBe("Centro");
    expect(zoneLeafName("bogota.centro_norte")).toBe("Centro norte");
    expect(zoneLeafName("medellin")).toBe("Medellin");
  });

  it("devuelve null sin path", () => {
    expect(zoneLeafName(null)).toBeNull();
    expect(zoneLeafName(undefined)).toBeNull();
    expect(zoneLeafName("")).toBeNull();
    expect(zoneLeafName(".")).toBeNull();
  });
});
