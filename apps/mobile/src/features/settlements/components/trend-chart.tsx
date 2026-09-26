import { useState } from "react";
import { Pressable, View, useColorScheme, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { formatMoney, Row, semanticColors, Stack, Text } from "@preztiaos/ui";

export interface TrendSeries {
  key: string;
  label: string;
  /** Un valor por período (unidades menores); puede ser negativo (utilidad). */
  values: number[];
}

// Paleta categórica validada (skill dataviz: slots 1–3, pasa CVD/contraste en claro y oscuro con
// las superficies de la app). Orden fijo: el color sigue a la serie, nunca a su posición.
const SERIES_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a"],
  dark: ["#3987e5", "#d95926", "#199e70"],
} as const;

const HEIGHT = 220;
const PAD = { top: 16, right: 84, bottom: 28, left: 12 };
const GRID_LINES = 3;
const MARKER_RADIUS = 4;
const LINE_WIDTH = 2;
const LABEL_MIN_GAP = 14;
const FALLBACK_WIDTH = 320;
// Máximo de etiquetas en el eje X (con más períodos se muestra una de cada N).
const MAX_X_LABELS = 6;

/**
 * Tendencia de varias series por período (cobrado, prestado, utilidad) sobre react-native-svg.
 * Un solo eje Y que siempre incluye el cero (la utilidad puede ser negativa); grilla tenue;
 * leyenda + etiquetas directas al final de cada línea (la identidad nunca es solo color). Tocar un
 * período fija la guía y muestra sus valores; la tabla del histórico es la vista accesible.
 */
export function TrendChart({
  periods,
  series,
  currency,
}: {
  periods: string[];
  series: TrendSeries[];
  currency: string;
}) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const ink = semanticColors[scheme];
  const colors = SERIES_COLORS[scheme];
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [selected, setSelected] = useState<number>(periods.length - 1);

  const onLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.width;
    if (measured > 0 && Math.abs(measured - width) > 1) setWidth(measured);
  };

  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = periods.length > 1 ? plotW / (periods.length - 1) : 0;
  const x = (i: number) => PAD.left + (periods.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => PAD.top + ((max - v) / span) * plotH;
  const labelEvery = Math.ceil(periods.length / MAX_X_LABELS);
  // Etiquetas del eje X: cada `labelEvery`, siempre la última, sin que la penúltima la pise.
  const last = periods.length - 1;
  const xLabelIndexes = periods
    .map((_, i) => i)
    .filter((i) => i === last || (i % labelEvery === 0 && last - i >= labelEvery));
  const anchorOf = (i: number) => (i === 0 ? "start" : i === last ? "end" : "middle");

  // Etiquetas directas al final de cada línea, separadas para que no se pisen.
  const endLabels = series
    .map((s, i) => ({ label: s.label, y: y(s.values[s.values.length - 1] ?? 0), color: colors[i] }))
    .sort((a, b) => a.y - b.y)
    .reduce<{ label: string; y: number; color: string }[]>((acc, l) => {
      const prev = acc[acc.length - 1];
      acc.push({ ...l, y: prev && l.y - prev.y < LABEL_MIN_GAP ? prev.y + LABEL_MIN_GAP : l.y });
      return acc;
    }, []);

  return (
    <Stack gap="sm">
      <Row gap="md" className="flex-wrap">
        {series.map((s, i) => (
          <Row key={s.key} gap="xs" className="items-center">
            <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: colors[i] }} />
            <Text variant="caption">{s.label}</Text>
          </Row>
        ))}
      </Row>
      <View onLayout={onLayout} style={{ width: "100%" }}>
        <Svg width={width} height={HEIGHT}>
          {Array.from({ length: GRID_LINES + 1 }, (_, g) => {
            const gy = PAD.top + (g / GRID_LINES) * plotH;
            return <Line key={g} x1={PAD.left} x2={PAD.left + plotW} y1={gy} y2={gy} stroke={ink.border} strokeWidth={1} />;
          })}
          {min < 0 ? (
            <Line x1={PAD.left} x2={PAD.left + plotW} y1={y(0)} y2={y(0)} stroke={ink.textMuted} strokeWidth={1} />
          ) : null}
          {periods.length > 0 ? (
            <Line x1={x(selected)} x2={x(selected)} y1={PAD.top} y2={PAD.top + plotH} stroke={ink.textMuted} strokeDasharray="3 3" />
          ) : null}
          {series.map((s, i) => (
            <Polyline
              key={s.key}
              points={s.values.map((v, p) => `${x(p)},${y(v)}`).join(" ")}
              fill="none"
              stroke={colors[i]}
              strokeWidth={LINE_WIDTH}
              strokeLinejoin="round"
            />
          ))}
          {series.map((s, i) =>
            s.values.map((v, p) => (
              <Circle key={`${s.key}-${p}`} cx={x(p)} cy={y(v)} r={MARKER_RADIUS} fill={colors[i]} stroke={ink.surface} strokeWidth={2} />
            )),
          )}
          {endLabels.map((l) => (
            <SvgText key={l.label} x={PAD.left + plotW + 8} y={l.y + 4} fontSize={11} fill={ink.text}>
              {l.label}
            </SvgText>
          ))}
          {xLabelIndexes.map((i) => (
            <SvgText key={periods[i]} x={x(i)} y={HEIGHT - 8} fontSize={10} fill={ink.textMuted} textAnchor={anchorOf(i)}>
              {periods[i]}
            </SvgText>
          ))}
        </Svg>
        {/* Bandas táctiles más grandes que la marca: fijan el período leído. */}
        <View style={{ position: "absolute", left: 0, top: 0, width, height: HEIGHT, flexDirection: "row" }}>
          {periods.map((p, i) => (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityLabel={p}
              onPress={() => setSelected(i)}
              style={{
                position: "absolute",
                left: x(i) - Math.max(step, 24) / 2,
                width: Math.max(step, 24),
                top: 0,
                height: HEIGHT,
              }}
            />
          ))}
        </View>
      </View>
      {periods[selected] ? (
        <Stack gap="xs">
          <Text variant="label">{periods[selected]}</Text>
          {series.map((s, i) => (
            <Row key={s.key} className="items-center justify-between">
              <Row gap="xs" className="items-center">
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors[i] }} />
                <Text variant="caption" tone="muted">
                  {s.label}
                </Text>
              </Row>
              <Text variant="caption">{formatMoney(s.values[selected] ?? 0, currency)}</Text>
            </Row>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
