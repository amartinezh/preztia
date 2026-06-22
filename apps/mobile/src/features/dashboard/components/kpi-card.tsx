import { View } from "react-native";
import { Stack, Text } from "@preztiaos/ui";

import { tint } from "./palette";

interface KpiCardProps {
  /** Emoji o glifo corto que ancla visualmente la métrica (sin dependencia de iconos). */
  icon: string;
  label: string;
  /** Valor ya formateado (dinero o conteo). */
  value: string;
  /** Texto secundario opcional bajo el valor. */
  caption?: string;
  /** Color de acento de la métrica (de la paleta del dashboard). */
  accent: string;
  textColor: string;
  mutedColor: string;
  surfaceColor: string;
  borderColor: string;
}

/**
 * Tarjeta de un KPI: superficie redondeada con sombra sutil, una franja/insignia del color de
 * acento de la métrica, su valor destacado y una leyenda. Componente puramente visual: recibe
 * todo por props, sin conocer fetch ni dominio (separación tarjeta ↔ pantalla).
 */
export function KpiCard({
  icon,
  label,
  value,
  caption,
  accent,
  textColor,
  mutedColor,
  surfaceColor,
  borderColor,
}: KpiCardProps) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 150,
        borderRadius: 20,
        borderWidth: 1,
        borderColor,
        backgroundColor: surfaceColor,
        padding: 16,
        overflow: "hidden",
      }}
    >
      {/* Halo de acento difuso en la esquina, para el toque "vibrante pero profesional". */}
      <View
        style={{
          position: "absolute",
          top: -28,
          right: -28,
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: tint(accent, 0.18),
        }}
      />
      <Stack gap="sm">
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tint(accent, 0.2),
          }}
        >
          <Text style={{ fontSize: 18 }}>{icon}</Text>
        </View>
        <Text variant="caption" style={{ color: mutedColor }}>
          {label}
        </Text>
        <Text variant="subtitle" style={{ color: textColor }} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {caption ? (
          <Text variant="caption" style={{ color: accent }}>
            {caption}
          </Text>
        ) : null}
      </Stack>
    </View>
  );
}
