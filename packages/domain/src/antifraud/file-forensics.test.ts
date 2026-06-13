import { describe, it, expect } from "vitest";
import { reviewFileMetadata, type FileTechnicalMetadata } from "./file-forensics";

const limpio: FileTechnicalMetadata = {
  producer: "Microsoft: Print To PDF",
  creator: "Sistema de Facturación Enel",
  software: null,
  createDate: "2026-05-20T10:00:00Z",
  modifyDate: "2026-05-20T10:00:30Z",
};

describe("reviewFileMetadata", () => {
  it("sin metadata ⇒ sin alertas (no todo formato la trae)", () => {
    expect(reviewFileMetadata(null)).toEqual([]);
  });

  it("metadata limpia ⇒ sin alertas (re-grabación inmediata tolerada)", () => {
    expect(reviewFileMetadata(limpio)).toEqual([]);
  });

  it("Producer de editor de imágenes (Photoshop) ⇒ ALTA", () => {
    const alerts = reviewFileMetadata({ ...limpio, producer: "Adobe Photoshop 25.0" });
    expect(alerts.some((a) => a.campo === "producer" && a.severidad === "ALTA")).toBe(true);
  });

  it("CreatorTool Canva ⇒ ALTA", () => {
    const alerts = reviewFileMetadata({ ...limpio, creator: "Canva" });
    expect(alerts.some((a) => a.campo === "creator" && a.severidad === "ALTA")).toBe(true);
  });

  it("modificado mucho después de creado ⇒ MEDIA", () => {
    const alerts = reviewFileMetadata({
      ...limpio,
      createDate: "2026-05-20T10:00:00Z",
      modifyDate: "2026-05-23T18:00:00Z",
    });
    expect(alerts.some((a) => a.campo === "modifyDate" && a.severidad === "MEDIA")).toBe(true);
  });
});
