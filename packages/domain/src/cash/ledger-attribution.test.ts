import { describe, it, expect } from "vitest";
import { ConflictError } from "../shared/money";
import { assertZoneCanUseBox, canZoneUseBox, ledgerAttribution } from "./ledger-attribution";

describe("canZoneUseBox", () => {
  it("una caja sin zona (del tenant) la usa cualquier zona", () => {
    expect(canZoneUseBox("sur", null)).toBe(true);
  });

  it("la zona dueña y sus descendientes usan la caja", () => {
    expect(canZoneUseBox("norte", "norte")).toBe(true);
    expect(canZoneUseBox("norte.centro", "norte")).toBe(true);
    expect(canZoneUseBox("norte.centro.barrio_1", "norte")).toBe(true);
  });

  it("una zona hermana, el padre o un prefijo textual no la usan", () => {
    expect(canZoneUseBox("sur", "norte")).toBe(false);
    expect(canZoneUseBox("norte", "norte.centro")).toBe(false);
    expect(canZoneUseBox("norteno", "norte")).toBe(false);
  });
});

describe("assertZoneCanUseBox", () => {
  it("lanza ConflictError con código estable si la zona no puede usar la caja", () => {
    expect(() => assertZoneCanUseBox("sur", "norte")).toThrow(ConflictError);
    try {
      assertZoneCanUseBox("sur", "norte");
    } catch (err) {
      expect((err as ConflictError).code).toBe("BOX_NOT_USABLE_BY_ZONE");
    }
  });

  it("no lanza cuando la zona puede usarla", () => {
    expect(() => assertZoneCanUseBox("norte.centro", "norte")).not.toThrow();
  });
});

describe("ledgerAttribution", () => {
  const box = { zoneId: "zona-caja", assignedTo: null };

  it("la zona del origen (crédito) prevalece sobre la de la caja", () => {
    expect(ledgerAttribution({ originZoneId: "zona-credito", box }).zoneId).toBe("zona-credito");
  });

  it("sin origen, el asiento toma la zona de la caja", () => {
    expect(ledgerAttribution({ originZoneId: null, box }).zoneId).toBe("zona-caja");
  });

  it("caja del tenant sin origen ⇒ asiento sin zona", () => {
    expect(ledgerAttribution({ originZoneId: null, box: { zoneId: null, assignedTo: null } }).zoneId).toBeNull();
  });

  it("todo movimiento de una caja de ruta se atribuye a su cobrador", () => {
    const route = { zoneId: null, assignedTo: "cobrador-1" };
    expect(ledgerAttribution({ originZoneId: "z", box: route }).collectorId).toBe("cobrador-1");
    expect(ledgerAttribution({ originZoneId: "z", box }).collectorId).toBeNull();
  });

  it("el cobrador del origen (quien pidió el gasto) prevalece sobre el dueño de la caja", () => {
    expect(ledgerAttribution({ originZoneId: "z", originCollectorId: "cobrador-2", box }).collectorId).toBe(
      "cobrador-2",
    );
  });
});
