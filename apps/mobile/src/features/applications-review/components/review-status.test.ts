import { describe, expect, it } from "vitest";
import {
  applicationStatusBadge,
  documentLabel,
  documentStatusBadge,
  isOfferAwaitingClient,
  severityTone,
  verdictBadge,
} from "./review-status";

describe("verdictBadge", () => {
  it("approved es verde (success); rejected es rojo (danger); sin análisis es neutro", () => {
    expect(verdictBadge("approved").tone).toBe("success");
    expect(verdictBadge("suspicious").tone).toBe("warning");
    expect(verdictBadge("rejected").tone).toBe("danger");
    expect(verdictBadge(null).tone).toBe("neutral");
  });
});

describe("applicationStatusBadge / documentStatusBadge", () => {
  it("APPROVED/VALIDATED en verde; REJECTED en rojo", () => {
    expect(applicationStatusBadge("APPROVED").tone).toBe("success");
    expect(applicationStatusBadge("REJECTED").tone).toBe("danger");
    expect(documentStatusBadge("VALIDATED").tone).toBe("success");
    expect(documentStatusBadge("REJECTED").tone).toBe("danger");
  });
});

describe("severityTone", () => {
  it("CRITICA/ALTA → danger; MEDIA → warning; resto → neutral", () => {
    expect(severityTone("CRITICA")).toBe("danger");
    expect(severityTone("ALTA")).toBe("danger");
    expect(severityTone("MEDIA")).toBe("warning");
    expect(severityTone("BAJA")).toBe("neutral");
  });
});

describe("documentLabel", () => {
  it("traduce los tipos conocidos y devuelve la llave para los desconocidos", () => {
    expect(documentLabel("IDENTITY_DOCUMENT")).toBe("Documento de identidad");
    expect(documentLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});

describe("isOfferAwaitingClient", () => {
  it("solo observa en vivo mientras la respuesta del cliente está pendiente", () => {
    expect(isOfferAwaitingClient("AWAITING_SELECTION")).toBe(true);
    expect(isOfferAwaitingClient("AWAITING_ACCEPTANCE")).toBe(true);
  });

  it("no observa sin oferta, con respuesta ya dada ni sin detalle cargado", () => {
    expect(isOfferAwaitingClient("NOT_OFFERED")).toBe(false);
    expect(isOfferAwaitingClient("ACCEPTED")).toBe(false);
    expect(isOfferAwaitingClient("DECLINED")).toBe(false);
    expect(isOfferAwaitingClient(undefined)).toBe(false);
  });
});
