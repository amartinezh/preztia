import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

export interface BarDatum {
  label: string;
  value: number;
  color: string;
  /** Texto a pintar encima de la barra (p. ej. monto formateado). Si falta, usa `value`. */
  display?: string;
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  textColor: string;
  mutedColor: string;
}

const TOP_LABEL_HEIGHT = 22;
const BOTTOM_LABEL_HEIGHT = 20;
const BAR_GAP_RATIO = 0.4; // espacio entre barras como fracción del ancho de banda
const MIN_BAR_FRACTION = 0.02; // alto mínimo visible aunque el valor sea muy pequeño
const FALLBACK_WIDTH = 280;
const CORNER_RADIUS = 8;

/**
 * Gráfico de barras vertical sobre `react-native-svg` (ya instalado): sin dependencias nuevas.
 * Mide su ancho con `onLayout` para ser responsivo. Cada barra lleva un degradado sutil del
 * color de su métrica, su valor encima y la etiqueta debajo.
 */
export function BarChart({ data, height = 200, textColor, mutedColor }: BarChartProps) {
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  const onLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.width;
    if (measured > 0 && Math.abs(measured - width) > 1) setWidth(measured);
  };

  const plotHeight = height - TOP_LABEL_HEIGHT - BOTTOM_LABEL_HEIGHT;
  const maxValue = Math.max(1, ...data.map((d) => d.value));
  const bandWidth = data.length > 0 ? width / data.length : width;
  const barWidth = bandWidth * (1 - BAR_GAP_RATIO);

  return (
    <View onLayout={onLayout} style={{ width: "100%" }}>
      <Svg width={width} height={height}>
        <Defs>
          {data.map((d) => (
            <LinearGradient key={d.label} id={`bar-${d.label}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={d.color} stopOpacity={1} />
              <Stop offset="1" stopColor={d.color} stopOpacity={0.55} />
            </LinearGradient>
          ))}
        </Defs>
        {data.map((d, i) => {
          const fraction = Math.max(MIN_BAR_FRACTION, d.value / maxValue);
          const barHeight = plotHeight * fraction;
          const x = i * bandWidth + (bandWidth - barWidth) / 2;
          const y = TOP_LABEL_HEIGHT + (plotHeight - barHeight);
          return (
            <Rect
              key={d.label}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={CORNER_RADIUS}
              fill={`url(#bar-${d.label})`}
            />
          );
        })}
        {/* Etiquetas separadas del bucle de barras para que el texto quede siempre por encima. */}
        {data.map((d, i) => {
          const fraction = Math.max(MIN_BAR_FRACTION, d.value / maxValue);
          const barHeight = plotHeight * fraction;
          const cx = i * bandWidth + bandWidth / 2;
          const y = TOP_LABEL_HEIGHT + (plotHeight - barHeight);
          return (
            <SvgText
              key={`v-${d.label}`}
              x={cx}
              y={y - 6}
              fill={textColor}
              fontSize={12}
              fontWeight="600"
              textAnchor="middle"
            >
              {d.display ?? String(d.value)}
            </SvgText>
          );
        })}
        {data.map((d, i) => {
          const cx = i * bandWidth + bandWidth / 2;
          return (
            <SvgText
              key={`l-${d.label}`}
              x={cx}
              y={height - 6}
              fill={mutedColor}
              fontSize={11}
              textAnchor="middle"
            >
              {d.label}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}
