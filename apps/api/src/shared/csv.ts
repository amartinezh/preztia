// Utilidades de exportación CSV (reportería). Una sola forma de escapar celdas para todo el API.

// Primer carácter con el que una hoja de cálculo interpreta la celda como FÓRMULA. Los CSV llevan
// texto escrito por usuarios (motivos, nombres): sin neutralizarlo, abrir el archivo en Excel o
// Sheets podría ejecutar una fórmula (inyección CSV / DDE).
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Escapa una celda: neutraliza fórmulas y entrecomilla comillas, comas y saltos de línea. */
export function csvCell(value: string): string {
  const safe = FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** Arma el CSV completo (encabezado + filas) con cada celda escapada. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
