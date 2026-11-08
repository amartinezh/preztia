import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { Text, useBreakpoint } from "@preztiaos/ui";

export interface DataColumn {
  key: string;
  /** Texto YA formateado para la persona (p. ej. "1 oct – 31 oct"); la tabla no interpreta fechas. */
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

// Anchos en teléfono: la primera columna queda FIJA y el resto se desplaza en horizontal.
const LABEL_WIDTH = 170;
const CELL_WIDTH = 128;
// En escritorio (lg+) la etiqueta respira más y las celdas se reparten el ancho disponible.
const LABEL_WIDTH_WIDE = 220;
// Clave reservada para sincronizar la altura de la fila de encabezados.
const HEADER_KEY = "__header";
const FOOTER_KEY = "__footer";
// Diferencias menores a esto son ruido de redondeo del layout: no vale la pena volver a pintar.
const HEIGHT_EPSILON = 0.5;
const HEADER_TONE = "border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";

type Side = "label" | "cells";
type MeasuredHeights = Record<string, Partial<Record<Side, number>>>;

/**
 * Tabla de lectura para dirección (liquidaciones, históricos): filas = conceptos, columnas =
 * cajas/zonas/períodos. La PRIMERA COLUMNA QUEDA FIJA mientras las cifras se desplazan en
 * horizontal; en `lg+` las columnas son fluidas (se reparten el ancho, mínimo `CELL_WIDTH`) y la
 * tabla solo se desplaza cuando aun así no cabe. Cifras alineadas a la derecha, filas alternas,
 * totales resaltados y una fila de totales opcional (`footer`) al pie.
 *
 * La columna fija y las celdas viven en vistas distintas: cada fila mide su alto natural en ambos
 * lados y se aplica el mayor como `minHeight`, así una etiqueta de dos líneas nunca desalinea.
 */
export function DataTable({
  columns,
  rows,
  footer,
  empty,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  footer?: DataRow;
  empty?: string;
}) {
  const { isDesktop } = useBreakpoint();
  const [availableWidth, setAvailableWidth] = useState(0);
  const [heights, setHeights] = useState<MeasuredHeights>({});

  if (rows.length === 0 && empty) {
    return (
      <Text variant="caption" tone="muted">
        {empty}
      </Text>
    );
  }

  const labelWidth = isDesktop ? LABEL_WIDTH_WIDE : LABEL_WIDTH;
  const fluidCellWidth = Math.floor((availableWidth - labelWidth) / Math.max(columns.length, 1));
  const cellWidth = isDesktop && availableWidth > 0 ? Math.max(CELL_WIDTH, fluidCellWidth) : CELL_WIDTH;

  const measure = (key: string, side: Side) => (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setHeights((prev) => {
      const known = prev[key]?.[side];
      if (known !== undefined && Math.abs(known - height) < HEIGHT_EPSILON) return prev;
      return { ...prev, [key]: { ...prev[key], [side]: height } };
    });
  };
  const rowMinHeight = (key: string) => Math.max(heights[key]?.label ?? 0, heights[key]?.cells ?? 0) || undefined;

  const rowTone = (row: DataRow | undefined, index: number) =>
    row === footer
      ? "border-t border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
      : `${index % 2 === 1 ? "bg-zinc-50/60 dark:bg-zinc-900/40" : ""} ${
          row?.strong ? "border-t border-zinc-200 dark:border-zinc-700" : ""
        }`;

  const allRows: DataRow[] = footer ? [...rows, footer] : rows;
  const rowKey = (row: DataRow) => (row === footer ? FOOTER_KEY : row.key);

  return (
    <View
      onLayout={(event) => setAvailableWidth(event.nativeEvent.layout.width)}
      className="flex-row overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
    >
      {/* Columna fija: encabezado vacío + etiqueta de cada fila, con borde que la separa de las cifras. */}
      <View
        style={{ width: labelWidth }}
        className="z-10 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      >
        <SyncedCell
          minHeight={rowMinHeight(HEADER_KEY)}
          onMeasure={measure(HEADER_KEY, "label")}
          boxClassName={HEADER_TONE}
          contentClassName="px-3 py-2"
        >
          <Text variant="label" tone="muted" numberOfLines={2}>
            {" "}
          </Text>
        </SyncedCell>
        {allRows.map((row, index) => (
          <SyncedCell
            key={rowKey(row)}
            minHeight={rowMinHeight(rowKey(row))}
            onMeasure={measure(rowKey(row), "label")}
            boxClassName={rowTone(row, index)}
            contentClassName="px-3 py-2"
          >
            <Text variant={row.strong || row === footer ? "label" : "caption"} tone={row.strong || row === footer ? "default" : "muted"}>
              {row.label}
            </Text>
          </SyncedCell>
        ))}
      </View>

      {/* Cifras: se desplazan en horizontal cuando no caben; en escritorio se reparten el ancho. */}
      <ScrollView horizontal showsHorizontalScrollIndicator className="flex-1">
        <View>
          <SyncedCell
            minHeight={rowMinHeight(HEADER_KEY)}
            onMeasure={measure(HEADER_KEY, "cells")}
            boxClassName={HEADER_TONE}
            contentClassName="flex-row"
          >
            {columns.map((column) => (
              <Pressable
                key={column.key}
                disabled={!column.onPress}
                accessibilityRole={column.onPress ? "button" : undefined}
                onPress={column.onPress}
                style={{ width: cellWidth }}
                className="px-3 py-2"
              >
                <Text variant="label" tone={column.onPress ? "primary" : "muted"} className="text-right" numberOfLines={2}>
                  {column.label}
                </Text>
              </Pressable>
            ))}
          </SyncedCell>
          {allRows.map((row, index) => (
            <SyncedCell
              key={rowKey(row)}
              minHeight={rowMinHeight(rowKey(row))}
              onMeasure={measure(rowKey(row), "cells")}
              boxClassName={rowTone(row, index)}
              contentClassName="flex-row"
            >
              {row.cells.map((cell, i) => (
                <View key={`${row.key}-${columns[i]?.key ?? i}`} style={{ width: cellWidth }} className="px-3 py-2">
                  <Text variant={row.strong || row === footer ? "label" : "caption"} className="text-right">
                    {cell}
                  </Text>
                </View>
              ))}
            </SyncedCell>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Celda/fila con dos vistas: la exterior lleva fondo/bordes y acepta la altura mínima; la interior
 * lleva el contenido con su relleno y se mide SIN restricciones. Así ambos lados de una fila miden
 * lo mismo (texto + relleno) y la mayor de las dos medidas iguala la fila sin oscilar.
 */
function SyncedCell({
  minHeight,
  onMeasure,
  boxClassName,
  contentClassName,
  children,
}: {
  minHeight: number | undefined;
  onMeasure: (event: LayoutChangeEvent) => void;
  boxClassName: string;
  contentClassName: string;
  children: ReactNode;
}) {
  return (
    <View style={minHeight ? { minHeight } : undefined} className={boxClassName}>
      <View onLayout={onMeasure} className={contentClassName}>
        {children}
      </View>
    </View>
  );
}
