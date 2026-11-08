import { Pressable, View } from "react-native";
import { Row, Stack, Text } from "@preztiaos/ui";

import { dashboardPalette, tint } from "./palette";

export type PendingItem = {
  key: string;
  label: string;
  count: number;
  onPress: () => void;
};

interface PendingListProps {
  title: string;
  subtitle?: string;
  /** Todas las bandejas; aquí se ocultan las que están en cero. */
  items: PendingItem[];
  emptyLabel: string;
  textColor: string;
  mutedColor: string;
  surfaceColor: string;
  borderColor: string;
}

const COUNT_MIN_WIDTH = 36;

/**
 * "Pendientes": lo que espera una decisión humana, como filas tocables con contador que llevan a
 * la bandeja correspondiente. Solo muestra las bandejas con algo (> 0); si todo está en cero,
 * una sola línea lo dice. Presentación pura.
 */
export function PendingList({
  title,
  subtitle,
  items,
  emptyLabel,
  textColor,
  mutedColor,
  surfaceColor,
  borderColor,
}: PendingListProps) {
  const visible = items.filter((item) => item.count > 0);

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text variant="heading" style={{ color: textColor }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" style={{ color: mutedColor }}>
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      {visible.length === 0 ? (
        <Text style={{ color: mutedColor }}>{emptyLabel}</Text>
      ) : (
        <Stack gap="sm">
          {visible.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}: ${item.count}`}
              onPress={item.onPress}
              style={({ pressed }) => ({
                borderRadius: 16,
                borderWidth: 1,
                borderColor,
                backgroundColor: surfaceColor,
                padding: 14,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Row className="items-center justify-between gap-3">
                <Text variant="label" style={{ color: textColor, flex: 1 }}>
                  {item.label}
                </Text>
                <View
                  style={{
                    minWidth: COUNT_MIN_WIDTH,
                    alignItems: "center",
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    backgroundColor: tint(dashboardPalette.amber, 0.22),
                  }}
                >
                  <Text variant="label" style={{ color: textColor }}>
                    {String(item.count)}
                  </Text>
                </View>
                <Text variant="label" style={{ color: mutedColor }}>
                  ›
                </Text>
              </Row>
            </Pressable>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
