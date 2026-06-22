import { View } from "react-native";
import { Row, Stack, Text } from "@preztiaos/ui";

interface SectionHeaderProps {
  icon: string;
  title: string;
  subtitle?: string;
  accent: string;
  textColor: string;
  mutedColor: string;
}

/** Encabezado de una sección del dashboard: barra de acento + título + subtítulo. */
export function SectionHeader({ icon, title, subtitle, accent, textColor, mutedColor }: SectionHeaderProps) {
  return (
    <Row className="items-center gap-3">
      <View style={{ width: 4, height: 34, borderRadius: 2, backgroundColor: accent }} />
      <Stack gap="xs" className="flex-1">
        <Text variant="heading" style={{ color: textColor }}>
          {icon} {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" style={{ color: mutedColor }}>
            {subtitle}
          </Text>
        ) : null}
      </Stack>
    </Row>
  );
}
