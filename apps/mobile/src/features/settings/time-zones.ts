import type { SelectOption } from "@preztiaos/ui";

// Zonas horarias frecuentes de la operación (LatAm + Brasil por el contexto PIX).
export const TIME_ZONE_OPTIONS: SelectOption<string>[] = [
  { value: "America/Bogota", label: "Colombia (America/Bogota)" },
  { value: "America/Sao_Paulo", label: "Brasil (America/Sao_Paulo)" },
  { value: "America/Mexico_City", label: "México (America/Mexico_City)" },
  { value: "America/Lima", label: "Perú (America/Lima)" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina (Buenos Aires)" },
];

/** Opciones con la zona actual incluida aunque no sea de las frecuentes (nunca se "pierde"). */
export function timeZoneOptions(current: string): SelectOption<string>[] {
  return TIME_ZONE_OPTIONS.some((o) => o.value === current)
    ? TIME_ZONE_OPTIONS
    : [{ value: current, label: current }, ...TIME_ZONE_OPTIONS];
}
