import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { QR_QUIET_ZONE_MODULES, qrPathData, qrViewBoxSize, type QrModules } from "./qr-path";

function matrix(rows: number[][]): QrModules {
  return { size: rows.length, get: (r, c) => rows[r][c] };
}

const countDark = (m: QrModules) => {
  let dark = 0;
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) dark++;
  return dark;
};

describe("qrPathData", () => {
  it("dibuja un cuadrado por módulo oscuro, desplazado por el margen claro", () => {
    const path = qrPathData(matrix([[1, 0], [0, 1]]));
    const q = QR_QUIET_ZONE_MODULES;
    expect(path).toBe(`M${q} ${q}h1v1h-1zM${q + 1} ${q + 1}h1v1h-1z`);
  });

  it("devuelve un trazado vacío si no hay módulos oscuros", () => {
    expect(qrPathData(matrix([[0, 0], [0, 0]]))).toBe("");
  });

  it("cumple el invariante con un QR real del enlace de un bot", () => {
    const { modules } = QRCode.create("https://t.me/hospital_san_vicente_bot");
    const subpaths = qrPathData(modules).match(/M/g)?.length ?? 0;
    expect(subpaths).toBe(countDark(modules));
    expect(qrViewBoxSize(modules)).toBe(modules.size + QR_QUIET_ZONE_MODULES * 2);
  });
});
