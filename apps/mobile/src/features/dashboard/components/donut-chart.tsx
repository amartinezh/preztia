import { View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { Row, Stack, Text } from "@preztiaos/ui";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  slices: DonutSlice[];
  /** Diámetro del gráfico en px. */
  size?: number;
  /** Grosor del anillo en px. */
  thickness?: number;
  /** Texto grande del centro (p. ej. el total). */
  centerLabel: string;
  /** Texto pequeño bajo el central. */
  centerCaption?: string;
  /** Color base del anillo (track) y del texto, según el tema. */
  trackColor: string;
  textColor: string;
  mutedColor: string;
}

const FULL_CIRCLE_DEGREES = 360;

/**
 * Gráfico de dona puro sobre `react-native-svg` (ya instalado): sin dependencias nuevas y 100%
 * compatible con Expo. Cada porción es un arco dibujado con `strokeDasharray`/`strokeDashoffset`
 * sobre un círculo; el conjunto se rota -90° para arrancar arriba. A la derecha, su leyenda.
 */
export function DonutChart({
  slices,
  size = 168,
  thickness = 26,
  centerLabel,
  centerCaption,
  trackColor,
  textColor,
  mutedColor,
}: DonutChartProps) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const total = slices.reduce((acc, s) => acc + s.value, 0);

  // Cada arco empieza donde terminó el anterior. Calculamos el offset como suma de las
  // fracciones previas (prefix sum inmutable), sin mutar variables durante el render.
  const fractions = slices.map((slice) => (total > 0 ? slice.value / total : 0));
  const arcs = slices.map((slice, i) => {
    const fraction = fractions[i] ?? 0;
    const offsetFraction = fractions.slice(0, i).reduce((acc, f) => acc + f, 0);
    return {
      ...slice,
      fraction,
      dashLength: circumference * fraction,
      offset: circumference * offsetFraction,
    };
  });

  return (
    <Row className="items-center gap-4">
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* Rotamos el lienzo para que el primer arco arranque en las 12 en punto. Usamos la prop
              estándar SVG `transform="rotate(a cx cy)"` (no `rotation`/`origin`) porque en web esas
              props generan el atributo DOM inválido `transform-origin`. */}
          <G transform={`rotate(-90 ${center} ${center})`}>
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={trackColor}
              strokeWidth={thickness}
              fill="none"
            />
            {total > 0
              ? arcs.map((arc) => (
                  <Circle
                    key={arc.label}
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={arc.color}
                    strokeWidth={thickness}
                    strokeLinecap="butt"
                    fill="none"
                    strokeDasharray={`${arc.dashLength} ${circumference - arc.dashLength}`}
                    strokeDashoffset={-arc.offset}
                  />
                ))
              : null}
          </G>
        </Svg>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text variant="heading" style={{ color: textColor }}>
            {centerLabel}
          </Text>
          {centerCaption ? (
            <Text variant="caption" style={{ color: mutedColor }}>
              {centerCaption}
            </Text>
          ) : null}
        </View>
      </View>

      <Stack gap="sm" className="flex-1">
        {arcs.map((arc) => (
          <Row key={arc.label} className="items-center gap-2">
            <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: arc.color }} />
            <Text variant="caption" style={{ color: mutedColor, flex: 1 }}>
              {arc.label}
            </Text>
            <Text variant="label" style={{ color: textColor }}>
              {arc.value}
            </Text>
            <Text variant="caption" style={{ color: mutedColor }}>
              {Math.round(arc.fraction * 100)}%
            </Text>
          </Row>
        ))}
      </Stack>
    </Row>
  );
}

// Exportado por si una vista necesita los grados de una porción (sin número mágico repartido).
export const fullCircleDegrees = FULL_CIRCLE_DEGREES;
