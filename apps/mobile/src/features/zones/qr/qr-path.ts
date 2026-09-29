/** Matriz de módulos de un QR (subconjunto de la `BitMatrix` de `qrcode`). */
export type QrModules = {
  readonly size: number;
  get(row: number, col: number): number | boolean;
};

/**
 * Margen claro alrededor del QR, en módulos. El estándar pide 4; con 2 los lectores de cámara lo
 * leen igual y el código se ve más grande en la tarjeta.
 */
export const QR_QUIET_ZONE_MODULES = 2;

/** Lado del lienzo en módulos, contando el margen claro por ambos lados. */
export function qrViewBoxSize(modules: QrModules): number {
  return modules.size + QR_QUIET_ZONE_MODULES * 2;
}

/**
 * Trazado SVG con un cuadrado 1×1 por módulo oscuro, desplazado por el margen claro. Un solo
 * `<Path>` en vez de un `<Rect>` por módulo: cientos de nodos menos en React Native.
 * Invariante: hay exactamente un subtrazado `M…z` por módulo oscuro.
 */
export function qrPathData(modules: QrModules): string {
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      const x = col + QR_QUIET_ZONE_MODULES;
      const y = row + QR_QUIET_ZONE_MODULES;
      parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return parts.join("");
}
