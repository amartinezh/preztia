import { describe, expect, it } from "vitest";
import {
  applicationStatusBadge,
  documentLabel,
  documentStatusBadge,
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
