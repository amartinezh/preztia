import { View } from "react-native";
import { Row, Stack, Text } from "@preztiaos/ui";

export interface TimelineStage {
  label: string;
  /** Duración media del tramo en minutos (define el ancho del segmento). */
  minutes: number;
  /** Duración ya formateada para leer (p. ej. "2 h 15 min"). */
  display: string;
  color: string;
}

interface StageTimelineProps {
  stages: TimelineStage[];
  textColor: string;
  mutedColor: string;
  /** Fondo del riel cuando no hay datos. */
  trackColor: string;
  /** Texto a mostrar cuando el periodo no tiene datos. */
  emptyLabel: string;
}

// Ancho mínimo relativo de un segmento para que siga siendo visible aunque su tramo sea corto.
const MIN_SEGMENT_FLEX = 0.04;

/**
 * Línea de tiempo por etapas: una barra horizontal segmentada donde el ancho de cada tramo es
 * proporcional a su duración media. Revela de un vistazo qué etapa concentra la demora (el
 * segmento más ancho es el cuello de botella). Debajo, la leyenda con la duración y el % de cada
 * tramo. Componente puramente visual (recibe todo por props); usa Views con `flex`, sin SVG.
 */
export function StageTimeline({ stages, textColor, mutedColor, trackColor, emptyLabel }: StageTimelineProps) {
  const total = stages.reduce((acc, stage) => acc + Math.max(0, stage.minutes), 0);

  return (
    <Stack gap="md">
      <View
        style={{
          height: 16,
          borderRadius: 8,
          overflow: "hidden",
          flexDirection: "row",
          backgroundColor: trackColor,
        }}
      >
        {total > 0
          ? stages.map((stage) => (
              <View
                key={stage.label}
                style={{
                  flex: Math.max(MIN_SEGMENT_FLEX, Math.max(0, stage.minutes) / total),
                  backgroundColor: stage.color,
                }}
              />
            ))
          : null}
      </View>

      {total > 0 ? (
        <Stack gap="sm">
          {stages.map((stage) => (
            <Row key={stage.label} className="items-center gap-2">
              <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: stage.color }} />
              <Text variant="caption" style={{ color: mutedColor, flex: 1 }}>
                {stage.label}
              </Text>
              <Text variant="label" style={{ color: textColor }}>
                {stage.display}
              </Text>
              <Text variant="caption" style={{ color: mutedColor }}>
                {Math.round((Math.max(0, stage.minutes) / total) * 100)}%
              </Text>
            </Row>
          ))}
        </Stack>
      ) : (
        <Text variant="caption" style={{ color: mutedColor }}>
          {emptyLabel}
        </Text>
      )}
    </Stack>
  );
}
