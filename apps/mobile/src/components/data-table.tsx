import { Pressable, ScrollView, View } from "react-native";
import { Text } from "@preztiaos/ui";

export interface DataColumn {
  key: string;
  label: string;
  /** Acción al tocar el encabezado (p. ej. abrir el período de esa columna). */
  onPress?: () => void;
}

export interface DataRow {
  key: string;
  label: string;
  cells: string[];
  /** Fila de total/resultado: se resalta. */
  strong?: boolean;
}

// Anchos fijos: la tabla se desplaza en horizontal cuando no cabe (teléfono), sin romper la página.
const LABEL_WIDTH = 170;
const CELL_WIDTH = 128;

/**
 * Tabla de lectura para dirección (liquidaciones, históricos): filas = conceptos, columnas =
 * cajas/zonas/períodos. Cifras alineadas a la derecha, filas alternas y totales resaltados; en
 * pantallas angostas se desplaza horizontalmente dentro de su contenedor.
 */
export function DataTable({ columns, rows, empty }: { columns: DataColumn[]; rows: DataRow[]; empty?: string }) {
  if (rows.length === 0 && empty) {
    return (
      <Text variant="caption" tone="muted">
        {empty}
      </Text>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <View className="flex-row border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
          <View style={{ width: LABEL_WIDTH }} className="px-3 py-2" />
          {columns.map((c) => (
            <Pressable
              key={c.key}
              disabled={!c.onPress}
              accessibilityRole={c.onPress ? "button" : undefined}
              onPress={c.onPress}
              style={{ width: CELL_WIDTH }}
              className="px-3 py-2"
            >
              <Text variant="label" tone={c.onPress ? "primary" : "muted"} className="text-right" numberOfLines={2}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {rows.map((r, index) => (
          <View
            key={r.key}
            className={`flex-row ${index % 2 === 1 ? "bg-zinc-50/60 dark:bg-zinc-900/40" : ""} ${
              r.strong ? "border-t border-zinc-200 dark:border-zinc-700" : ""
            }`}
          >
            <View style={{ width: LABEL_WIDTH }} className="px-3 py-2">
              <Text variant={r.strong ? "label" : "caption"} tone={r.strong ? "default" : "muted"}>
                {r.label}
              </Text>
            </View>
            {r.cells.map((cell, i) => (
              <View key={`${r.key}-${columns[i]?.key ?? i}`} style={{ width: CELL_WIDTH }} className="px-3 py-2">
                <Text variant={r.strong ? "label" : "caption"} className="text-right">
                  {cell}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
